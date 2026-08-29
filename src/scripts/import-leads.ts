/**
 * One-off (but safely repeatable) import of the v1 JSON snapshots into Postgres.
 *
 *   npm run import:leads
 *
 * Reads leads-uk.json and leads-dubai.json from the repo root. Existing leads
 * are matched on (region, dedupe key) and refreshed; a status already set in
 * the database is never overwritten.
 */
import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { leads } from "../db/schema";
import { dedupeKeyFor } from "../lib/leads";

type RawLead = {
  id?: string;
  agent?: string;
  title?: string;
  fit?: string;
  what?: string;
  where?: string;
  entity?: string;
  address?: string;
  contact?: string;
  role?: string;
  src?: string;
  status?: string;
};

const FILES: Array<{ file: string; region: "UK" | "Dubai" }> = [
  { file: "leads-uk.json", region: "UK" },
  { file: "leads-dubai.json", region: "Dubai" },
];

const FITS = new Set(["High", "Medium", "Low"]);
const STATUSES = new Set(["New", "Approved", "Rejected"]);

async function importFile(file: string, region: "UK" | "Dubai") {
  const full = path.join(process.cwd(), file);
  let text: string;
  try {
    text = await readFile(full, "utf8");
  } catch {
    console.log(`· ${file} not found, skipping`);
    return;
  }

  const parsed = JSON.parse(text) as { leads?: RawLead[] };
  const rows = parsed.leads ?? [];
  let created = 0;
  let refreshed = 0;
  let skipped = 0;

  for (const raw of rows) {
    const title = (raw.title ?? "").trim();
    if (!title) {
      skipped++;
      continue;
    }
    const dedupeKey = dedupeKeyFor({ id: raw.id, title, where: raw.where });
    const existing = (
      await db
        .select({ id: leads.id })
        .from(leads)
        .where(and(eq(leads.region, region), eq(leads.dedupeKey, dedupeKey)))
        .limit(1)
    )[0];

    const status = STATUSES.has(raw.status ?? "")
      ? (raw.status as "New" | "Approved" | "Rejected")
      : "New";

    await db
      .insert(leads)
      .values({
        region,
        sourceId: raw.id ?? null,
        dedupeKey,
        agent: raw.agent ?? "Unknown",
        title,
        fit: FITS.has(raw.fit ?? "") ? (raw.fit as "High" | "Medium" | "Low") : "Medium",
        what: raw.what ?? "",
        whereText: raw.where ?? null,
        entity: raw.entity ?? null,
        address: raw.address ?? null,
        contact: raw.contact ?? null,
        role: raw.role ?? null,
        src: raw.src ?? null,
        status,
      })
      .onConflictDoUpdate({
        target: [leads.region, leads.dedupeKey],
        set: {
          agent: sql`excluded.agent`,
          title: sql`excluded.title`,
          fit: sql`excluded.fit`,
          what: sql`excluded.what`,
          whereText: sql`excluded.where_text`,
          entity: sql`excluded.entity`,
          address: sql`excluded.address`,
          contact: sql`excluded.contact`,
          role: sql`excluded.role`,
          src: sql`excluded.src`,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      });

    if (existing) refreshed++;
    else created++;
  }

  console.log(
    `· ${file} → ${region}: ${created} new, ${refreshed} refreshed` +
      (skipped ? `, ${skipped} skipped (no title)` : ""),
  );
}

async function main() {
  for (const { file, region } of FILES) await importFile(file, region);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(leads);
  console.log(`\nDone. ${n} leads in the database.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
