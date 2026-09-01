/**
 * Prove that a scanner rerun cannot disturb the pipeline.
 *
 *   npx tsx src/scripts/check-rerun-isolation.ts [url]     (default localhost:3000)
 *
 * `test-ingest.ts` proves ingest refreshes facts without overwriting a status.
 * This proves the wider version of the same rule now that a lead carries far
 * more than a status: an activity, a follow-up, a verdict, and a link to an
 * organisation she attached by hand. A rerun must leave every one of those
 * alone while still refreshing the facts the scanner owns.
 *
 * `leads.organisationId` is the dangerous one. It sits on the table ingest
 * writes to and it looks exactly like a fact about the lead, so it is the field
 * most likely to be added to the upsert's `set` list by someone doing the
 * obvious thing. If that ever happens, this script fails.
 *
 * Same discipline as the other harnesses: tagged synthetic rows, cleanup in a
 * `finally`, deletes that refuse anything untagged, and every table compared
 * before and after.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });
import { eq, like, sql } from "drizzle-orm";
import { addDays, todayInLondon } from "../lib/dates";
import { createFollowUp, logActivity, recordFeedback, type Writer } from "../lib/pipeline-writes";
import { db } from "../db";
import {
  activities,
  contacts,
  followUps,
  leadFeedback,
  leadEvents,
  leads,
  organisations,
  people,
} from "../db/schema";

const target = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const key = process.env.INGEST_WRITE_KEY ?? process.env.INGEST_KEY;
const TAG = `test-rerun-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = todayInLondon();

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
}

const TABLES = {
  leads, people, organisations, contacts, activities,
  follow_ups: followUps, lead_feedback: leadFeedback, lead_events: leadEvents,
} as const;

async function counts() {
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries(TABLES)) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    out[name] = row.n;
  }
  return out;
}

/* Synthetic only. AGENTS.md forbids inventing lead data anywhere, fixtures
   included: no company, no person, no address, and the contact field uses the
   same `GAP — …` form the scanners write when they could not verify one. */
function batch(revision: "first" | "second") {
  return [
    {
      id: `${TAG}-a`,
      agent: "Events",
      title: `TEST ROW — rerun harness ${TAG} (safe to delete)`,
      fit: revision === "second" ? "High" : "Medium",
      what: `Synthetic row written by check-rerun-isolation.ts, revision ${revision}.`,
      where: "TEST — no location",
      contact: "GAP — synthetic test row, not a real contact",
    },
  ];
}

async function post(body: unknown) {
  const res = await fetch(`${target}/api/leads/ingest`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-ingest-key": key ?? "" },
    body: JSON.stringify(body),
  }).catch((e) => {
    throw new Error(`Could not reach ${target} — is it running?\n  ${e.message}`);
  });
  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    /* a protected preview answers with Vercel's own JSON envelope */
  }
  return { status: res.status, json, text };
}

async function main() {
  if (!key) {
    console.error("INGEST_WRITE_KEY is not set.");
    process.exit(1);
  }
  console.log(`target : ${target}`);
  console.log(`tag    : ${TAG}\n`);

  const before = await counts();
  console.log("Rows before:", JSON.stringify(before), "\n");

  const [actor] = await db.select().from(people).limit(1);
  if (!actor) {
    console.error("No people rows — run `npm run people:add` first.");
    process.exit(1);
  }
  const writer: Writer = { personId: actor.id, email: actor.email };

  const runIds: string[] = [];

  try {
    /* 1 ------------------------------------------------- the scanner finds it */
    console.log("1. A scanner produces the lead");
    const first = await post({ region: "UK", agent: "Events", leads: batch("first") });
    check("HTTP 200", first.status === 200, `got ${first.status} ${first.text.slice(0, 90)}`);
    if (first.json?.runId) runIds.push(String(first.json.runId));
    check("created 1", first.json?.created === 1, JSON.stringify(first.json));

    const [lead] = await db.select().from(leads).where(eq(leads.dedupeKey, `${TAG}-a`)).limit(1);
    check("the lead is in the database", !!lead);
    if (!lead) throw new Error("cannot continue");

    /* 2 --------------------------------------- a person builds on top of it */
    console.log("\n2. A person works it: approves, links, logs, chases, judges");
    const logged = await logActivity(writer, {
      kind: "email_sent",
      occurredAt: TODAY,
      summary: "Emailed about it",
      leadId: lead.id,
      approveLead: true,
      newOrganisation: { name: `TEST ORG ${TAG}` },
      newContact: { name: `TEST CONTACT ${TAG}`, email: `${TAG}@example.invalid` },
    });
    check("contact logged and lead approved", logged.ok, logged.ok ? "" : logged.error);
    if (!logged.ok) throw new Error("cannot continue");
    const organisationId = logged.data.organisationId!;

    /* Attached by hand, the way a future UI will. This is the field most likely
       to be mistaken for a fact and added to the ingest upsert. */
    await db.update(leads).set({ organisationId }).where(eq(leads.id, lead.id));

    const fu = await createFollowUp(writer, {
      dueAt: addDays(TODAY, 7), note: "Chase if no reply", leadId: lead.id,
    });
    check("follow-up set", fu.ok, fu.ok ? "" : fu.error);
    const fb = await recordFeedback(writer, lead.id, {
      verdict: "not_useful", reason: "bad_timing", note: "Right client, wrong month",
    });
    check("verdict recorded", fb.ok, fb.ok ? "" : fb.error);

    const beforeRerun = {
      lead: (await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1))[0],
      activities: await db.select().from(activities).where(eq(activities.leadId, lead.id)),
      followUps: await db.select().from(followUps).where(eq(followUps.leadId, lead.id)),
      feedback: await db.select().from(leadFeedback).where(eq(leadFeedback.leadId, lead.id)),
      events: await db.select().from(leadEvents).where(eq(leadEvents.leadId, lead.id)),
    };

    /* 3 ----------------------------------------------- the scanner runs again */
    console.log("\n3. The scanner reruns with changed facts");
    const second = await post({ region: "UK", agent: "Events", leads: batch("second") });
    check("HTTP 200", second.status === 200, `got ${second.status}`);
    if (second.json?.runId) runIds.push(String(second.json.runId));
    check("created nothing, counted a duplicate",
      second.json?.created === 0 && second.json?.duplicate === 1, JSON.stringify(second.json));

    const [after] = await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1);

    console.log("\n4. The facts refreshed");
    check("`what` moved to revision two", after.what.includes("revision second"), after.what);
    check("`fit` refreshed Medium to High", after.fit === "High", after.fit);
    check("lastSeenAt moved on", after.lastSeenAt > beforeRerun.lead.lastSeenAt);

    console.log("\n5. Nothing a person decided was touched");
    check("status is still Approved", after.status === "Approved", after.status);
    check("organisationId survived the rerun",
      after.organisationId === organisationId, String(after.organisationId));
    check("statusChangedAt was not cleared", after.statusChangedAt !== null);
    check("statusChangedBy still records who", after.statusChangedBy === actor.id);

    const acts = await db.select().from(activities).where(eq(activities.leadId, lead.id));
    check("the activity is untouched",
      acts.length === beforeRerun.activities.length &&
        acts[0]?.summary === beforeRerun.activities[0]?.summary &&
        acts[0]?.occurredAt === beforeRerun.activities[0]?.occurredAt,
      `${acts.length} activities`);

    const fus = await db.select().from(followUps).where(eq(followUps.leadId, lead.id));
    check("the follow-up is untouched",
      fus.length === 1 && fus[0].dueAt === beforeRerun.followUps[0].dueAt &&
        fus[0].status === "open" && fus[0].note === beforeRerun.followUps[0].note,
      `${fus.length} follow-ups`);

    const fbs = await db.select().from(leadFeedback).where(eq(leadFeedback.leadId, lead.id));
    check("the verdict is untouched",
      fbs.length === 1 && fbs[0].verdict === "not_useful" && fbs[0].reason === "bad_timing" &&
        fbs[0].note === beforeRerun.feedback[0].note,
      `${fbs.length} feedback rows`);

    const evs = await db.select().from(leadEvents).where(eq(leadEvents.leadId, lead.id));
    check("the audit trail gained nothing spurious",
      evs.length === beforeRerun.events.length, `${evs.length} events`);

    const orgStill = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(organisations)
      .where(eq(organisations.id, organisationId));
    check("the organisation still exists", orgStill[0].n === 1);
  } finally {
    console.log("\n6. Cleaning up");
    const tl = await db.select({ id: leads.id, k: leads.dedupeKey }).from(leads)
      .where(like(leads.dedupeKey, `${TAG}%`));
    const to = await db.select({ id: organisations.id, k: organisations.dedupeKey })
      .from(organisations).where(like(organisations.dedupeKey, `%${TAG.toLowerCase()}%`));
    if (tl.some((r) => !r.k.startsWith(TAG))) throw new Error("refusing to delete untagged leads");
    if (to.some((r) => !r.k.includes(TAG.toLowerCase()))) throw new Error("refusing to delete untagged organisations");
    if (tl.length) await db.delete(leads).where(like(leads.dedupeKey, `${TAG}%`));
    if (to.length) await db.delete(organisations).where(like(organisations.dedupeKey, `%${TAG.toLowerCase()}%`));
    /* agent_runs is not in the before/after comparison, so clear the two rows
       this made rather than leaving them as debris. */
    for (const id of runIds) {
      await db.execute(sql`delete from agent_runs where id = ${id}::uuid`);
    }
    console.log(`  removed ${tl.length} lead(s), ${to.length} organisation(s), ${runIds.length} run(s)`);

    const after = await counts();
    let clean = true;
    for (const k of Object.keys(before)) {
      if (after[k] !== before[k]) {
        clean = false;
        console.log(`  FAIL ${k}: ${after[k]}, expected ${before[k]}`);
      }
    }
    check("every table is back to its starting count", clean, JSON.stringify(after));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n" + (error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exit(1);
});
