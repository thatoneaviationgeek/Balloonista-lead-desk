import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { checkScannerKey } from "@/lib/ingest-auth";
import { db } from "@/db";
import { agentRuns, leads } from "@/db/schema";
import { dedupeKeyFor } from "@/lib/leads";

/* The scanners POST here instead of writing a Google Sheet and a hand-built
   JSON file. Authenticate with INGEST_WRITE_KEY:
     curl -X POST https://…/api/leads/ingest \
       -H "x-ingest-key: $INGEST_WRITE_KEY" -H "content-type: application/json" \
       -d '{"region":"UK","agent":"Film","leads":[…]}'

   Decisions are never overwritten — once Aurelija has approved or rejected a
   lead, or attached it to an organisation she is already working, a rerun of
   the scanner leaves that alone. `status` and `organisationId` are hers; only
   the facts below get refreshed. */

type Incoming = {
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
};

const FITS = new Set(["High", "Medium", "Low"]);

export async function POST(request: Request) {
  const refused = checkScannerKey(request, "write");
  if (refused) return refused;

  const body = (await request.json().catch(() => null)) as {
    region?: string;
    agent?: string;
    leads?: Incoming[];
    meta?: unknown;
  } | null;

  const region = body?.region === "Dubai" ? "Dubai" : body?.region === "UK" ? "UK" : null;
  if (!region || !Array.isArray(body?.leads)) {
    return NextResponse.json(
      { error: "Body must be { region: 'UK' | 'Dubai', leads: [...] }" },
      { status: 400 },
    );
  }

  const runAgent = body.agent ?? body.leads[0]?.agent ?? "unknown";
  const [run] = await db
    .insert(agentRuns)
    .values({ agent: runAgent, region, status: "running", meta: body.meta ?? null })
    .returning();

  let created = 0;
  let duplicate = 0;

  try {
    for (const raw of body.leads) {
      const title = (raw.title ?? "").trim();
      if (!title) continue;
      const dedupeKey = dedupeKeyFor({ id: raw.id, title, where: raw.where });
      const fit = FITS.has(raw.fit ?? "") ? (raw.fit as "High" | "Medium" | "Low") : "Medium";

      const before = (
        await db
          .select({ id: leads.id })
          .from(leads)
          .where(and(eq(leads.region, region), eq(leads.dedupeKey, dedupeKey)))
          .limit(1)
      )[0];

      await db
        .insert(leads)
        .values({
          region,
          sourceId: raw.id ?? null,
          dedupeKey,
          agent: raw.agent ?? runAgent,
          title,
          fit,
          what: raw.what ?? "",
          whereText: raw.where ?? null,
          entity: raw.entity ?? null,
          address: raw.address ?? null,
          contact: raw.contact ?? null,
          role: raw.role ?? null,
          src: raw.src ?? null,
        })
        .onConflictDoUpdate({
          target: [leads.region, leads.dedupeKey],
          set: {
            /* Refresh the facts, never the decisions. Nothing that a person set
               by hand belongs in this list — not `status`, not `statusChangedAt`,
               and not `organisationId`, which looks like a fact about the lead
               but is a link she made herself. */
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

      if (before) duplicate++;
      else created++;
    }

    await db
      .update(agentRuns)
      .set({
        status: "ok",
        finishedAt: new Date(),
        leadsFound: body.leads.length,
        leadsNew: created,
        leadsDuplicate: duplicate,
      })
      .where(eq(agentRuns.id, run.id));

    return NextResponse.json({
      ok: true,
      runId: run.id,
      found: body.leads.length,
      created,
      duplicate,
    });
  } catch (error) {
    await db
      .update(agentRuns)
      .set({
        status: "failed",
        finishedAt: new Date(),
        error: error instanceof Error ? error.message : String(error),
      })
      .where(eq(agentRuns.id, run.id));
    throw error;
  }
}
