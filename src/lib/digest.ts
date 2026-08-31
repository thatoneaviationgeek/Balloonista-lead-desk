/**
 * The feedback digest the scanners read at the start of a run.
 *
 * Feedback nothing ever reads is theatre, so this is the half that closes the
 * loop. The scanners are Claude scheduled tasks: nothing is being trained, and
 * her verdicts make the next run's prompt better. That is worth doing, and it is
 * not machine learning — the UI copy should say so.
 *
 * WHAT THIS MAY NOT CARRY. `INGEST_KEY` is a write credential held by the
 * scanners; this endpoint turns it into a read credential too, so the boundary
 * is drawn in the data rather than left to each caller. Lead-level material
 * only: title, scanner, region, fit, her verdict, the reason and her note.
 *
 * Never contact names, email addresses or phone numbers. That means the
 * `contacts` table is not joined here at all, and `leads.contact`,
 * `leads.address` and `leads.role` are deliberately not selected even though
 * they sit on a row this query already has. Third-party personal data has no
 * business in a scanner prompt.
 */
import { and, desc, eq, gte, sql } from "drizzle-orm";
import {
  FEEDBACK_REASON_LABEL,
  type FeedbackReason,
} from "./pipeline";
import { db } from "@/db";
import { leadFeedback, leads } from "@/db/schema";

export type DigestFilters = {
  agent: string | null;
  region: "UK" | "Dubai" | null;
  since: string | null;
};

export type DigestExample = {
  title: string;
  agent: string;
  region: "UK" | "Dubai";
  fit: string;
  reason: string | null;
  reasonLabel: string | null;
  note: string | null;
};

export type Digest = {
  generatedAt: string;
  filters: DigestFilters;
  totals: { useful: number; notUseful: number; total: number };
  byReason: { reason: FeedbackReason; label: string; count: number }[];
  byAgent: { agent: string; useful: number; notUseful: number }[];
  examples: { useful: DigestExample[]; notUseful: DigestExample[] };
  promptText: string;
};

const EXAMPLES_PER_SIDE = 8;

export async function buildDigest(filters: DigestFilters): Promise<Digest> {
  const where = [
    filters.agent ? eq(leads.agent, filters.agent) : undefined,
    filters.region ? eq(leads.region, filters.region) : undefined,
    filters.since ? gte(leadFeedback.updatedAt, new Date(filters.since)) : undefined,
  ].filter(Boolean);

  /* Note the columns that are absent: leads.contact, leads.address and
     leads.role are not selected. See the boundary note at the top. */
  const rows = await db
    .select({
      verdict: leadFeedback.verdict,
      reason: leadFeedback.reason,
      note: leadFeedback.note,
      updatedAt: leadFeedback.updatedAt,
      title: leads.title,
      agent: leads.agent,
      region: leads.region,
      fit: leads.fit,
    })
    .from(leadFeedback)
    .innerJoin(leads, eq(leadFeedback.leadId, leads.id))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(leadFeedback.updatedAt));

  const useful = rows.filter((r) => r.verdict === "useful");
  const notUseful = rows.filter((r) => r.verdict === "not_useful");

  const reasonCounts = new Map<FeedbackReason, number>();
  for (const r of notUseful) {
    if (!r.reason) continue;
    reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1);
  }

  const agentCounts = new Map<string, { useful: number; notUseful: number }>();
  for (const r of rows) {
    const entry = agentCounts.get(r.agent) ?? { useful: 0, notUseful: 0 };
    if (r.verdict === "useful") entry.useful++;
    else entry.notUseful++;
    agentCounts.set(r.agent, entry);
  }

  const toExample = (r: (typeof rows)[number]): DigestExample => ({
    title: r.title,
    agent: r.agent,
    region: r.region,
    fit: r.fit,
    reason: r.reason,
    reasonLabel: r.reason ? FEEDBACK_REASON_LABEL[r.reason] : null,
    note: r.note,
  });

  const digest: Omit<Digest, "promptText"> = {
    generatedAt: new Date().toISOString(),
    filters,
    totals: { useful: useful.length, notUseful: notUseful.length, total: rows.length },
    byReason: [...reasonCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([reason, count]) => ({ reason, label: FEEDBACK_REASON_LABEL[reason], count })),
    byAgent: [...agentCounts.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([agent, v]) => ({ agent, ...v })),
    examples: {
      useful: useful.slice(0, EXAMPLES_PER_SIDE).map(toExample),
      notUseful: notUseful.slice(0, EXAMPLES_PER_SIDE).map(toExample),
    },
  };

  return { ...digest, promptText: render(digest) };
}

/**
 * The pasteable block. Rendered here rather than in four scanner prompts, so
 * changing the wording is one edit instead of four that drift apart.
 */
function render(d: Omit<Digest, "promptText">): string {
  const scope = [
    d.filters.agent ? `scanner ${d.filters.agent}` : null,
    d.filters.region ? d.filters.region : null,
    d.filters.since ? `since ${d.filters.since.slice(0, 10)}` : null,
  ].filter(Boolean);

  const lines: string[] = [];
  lines.push(
    `Feedback on leads you have produced${scope.length ? ` (${scope.join(", ")})` : ""}.`,
  );

  if (d.totals.total === 0) {
    lines.push("");
    lines.push("No verdicts recorded yet. Carry on as briefed.");
    return lines.join("\n");
  }

  lines.push(
    `${d.totals.useful} judged useful, ${d.totals.notUseful} judged not useful, ${d.totals.total} in total.`,
  );

  if (d.byReason.length) {
    lines.push("");
    lines.push("Why leads were rejected, most common first:");
    for (const r of d.byReason) lines.push(`  - ${r.label}: ${r.count}`);
  }

  if (d.examples.notUseful.length) {
    lines.push("");
    lines.push("Recent rejections — avoid finding more like these:");
    for (const e of d.examples.notUseful) {
      const why = e.reasonLabel ?? "no reason given";
      lines.push(`  - [${e.agent}/${e.region}] ${e.title} — ${why}${e.note ? `. ${e.note}` : ""}`);
    }
  }

  if (d.examples.useful.length) {
    lines.push("");
    lines.push("Recent leads judged useful — find more like these:");
    for (const e of d.examples.useful) {
      lines.push(`  - [${e.agent}/${e.region}] ${e.title}${e.note ? ` — ${e.note}` : ""}`);
    }
  }

  lines.push("");
  lines.push(
    "Weigh this against your brief; it is a correction, not a replacement. Do not invent contacts to satisfy it — an unverified contact is still written as GAP.",
  );
  return lines.join("\n");
}

/** Total rows, for a cheap sanity check without building the whole digest. */
export async function countFeedback(): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(leadFeedback);
  return row?.n ?? 0;
}
