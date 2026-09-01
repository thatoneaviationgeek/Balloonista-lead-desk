/**
 * Prove /api/leads/ingest end to end against a running app.
 *
 *   npx tsx src/scripts/test-ingest.ts                          (localhost:3000)
 *   npx tsx src/scripts/test-ingest.ts http://localhost:3000
 *   npx tsx src/scripts/test-ingest.ts https://<preview-alias>
 *
 * Checks the four things that matter about ingest: it creates, it is idempotent,
 * it refreshes facts without ever touching a human's decision, and it refuses
 * bad requests.
 *
 * The database holds real leads. Every row this writes is tagged with a run id
 * unique to the process, everything tagged is removed in a `finally` block even
 * when an assertion fails, the delete refuses to touch anything untagged, and
 * the untagged count is compared before and after.
 *
 * Needs DATABASE_URL and INGEST_WRITE_KEY from .env.local, and the target app
 * must be running with the same write key.
 */
import { config as loadEnv } from "dotenv";

/* Next.js reads .env.local automatically; standalone scripts do not.
   Load .env.local first, then .env as a fallback. */
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { eq, inArray, like, not, sql } from "drizzle-orm";
import { db } from "../db";
import { agentRuns, leads } from "../db/schema";

const target = (process.argv[2] ?? "http://localhost:3000").replace(/\/+$/, "");
const key = process.env.INGEST_WRITE_KEY ?? process.env.INGEST_KEY;

/* Unique per run, and lower case so dedupeKeyFor() passes it through unchanged. */
const TAG = `test-ingest-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/* Synthetic rows only. AGENTS.md forbids inventing lead data anywhere in this
   codebase, fixtures included, so nothing here names a company, a person or an
   address: the contact field uses the same `GAP — …` form the scanners write
   when they could not verify one. */
function batch(revision: "first" | "second") {
  const second = revision === "second";
  return [
    {
      id: `${TAG}-a`,
      agent: "Events",
      title: `TEST ROW — ingest harness ${TAG} (safe to delete)`,
      fit: second ? "High" : "Medium",
      what: `Synthetic row written by test-ingest.ts, revision ${revision}.`,
      where: "TEST — no location",
      contact: "GAP — synthetic test row, not a real contact",
    },
    {
      id: `${TAG}-b`,
      agent: "Retail",
      title: `TEST ROW — ingest harness ${TAG} second row (safe to delete)`,
      fit: "Low",
      what: `Synthetic row written by test-ingest.ts, revision ${revision}.`,
      where: "TEST — no location",
      contact: "GAP — synthetic test row, not a real contact",
    },
  ];
}

type IngestResponse = {
  ok?: boolean;
  runId?: string;
  found?: number;
  created?: number;
  duplicate?: number;
  error?: string;
};

const runIds: string[] = [];
let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
}

async function post(body: unknown, ingestKey: string | undefined) {
  let res: Response;
  try {
    res = await fetch(`${target}/api/leads/ingest`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(ingestKey ? { "x-ingest-key": ingestKey } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(
      `Could not reach ${target} — is it running?\n  ` +
        (error instanceof Error ? error.message : String(error)),
    );
  }
  const text = await res.text();
  let json: IngestResponse | null = null;
  try {
    json = JSON.parse(text) as IngestResponse;
  } catch {
    /* a protected preview answers with HTML, or with Vercel's own JSON envelope */
  }
  if (json?.runId) runIds.push(json.runId);
  return { status: res.status, json, text };
}

const taggedRows = () => like(leads.dedupeKey, `${TAG}%`);

async function countUntagged() {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(not(like(leads.dedupeKey, `${TAG}%`)));
  return row.n;
}

async function taggedLeads() {
  return db.select().from(leads).where(taggedRows()).orderBy(leads.dedupeKey);
}

async function runFor(runId: string | undefined) {
  if (!runId) return undefined;
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId)).limit(1);
  return row;
}

async function cleanup() {
  const rows = await taggedLeads();
  const unsafe = rows.filter((r) => !r.dedupeKey.startsWith(TAG));
  if (unsafe.length) {
    throw new Error(`refusing to delete ${unsafe.length} untagged row(s)`);
  }
  if (rows.length) await db.delete(leads).where(taggedRows());
  if (runIds.length) await db.delete(agentRuns).where(inArray(agentRuns.id, runIds));
  return { leads: rows.length, runs: runIds.length };
}

async function main() {
  if (!key) {
    console.error("INGEST_WRITE_KEY is not set. Copy .env.example to .env.local and fill it in.");
    process.exit(1);
  }

  console.log(`target : ${target}`);
  console.log(`tag    : ${TAG}\n`);

  const untaggedBefore = await countUntagged();
  console.log(`Existing leads before the run: ${untaggedBefore}\n`);

  try {
    /* 1 -------------------------------------------------------- creates rows */
    console.log("1. A new batch is created, and the run is recorded");
    const first = await post({ region: "UK", agent: "Events", leads: batch("first") }, key);
    check("HTTP 200", first.status === 200, `got ${first.status}`);
    check(
      "found 2, created 2, duplicate 0",
      first.json?.found === 2 && first.json?.created === 2 && first.json?.duplicate === 0,
      JSON.stringify({
        found: first.json?.found,
        created: first.json?.created,
        duplicate: first.json?.duplicate,
      }),
    );

    const afterFirst = await taggedLeads();
    check("both leads are in the database", afterFirst.length === 2, `found ${afterFirst.length}`);
    check("region is UK", afterFirst.every((l) => l.region === "UK"));
    check("fit was taken from the payload", afterFirst[0]?.fit === "Medium", `got ${afterFirst[0]?.fit}`);
    check("status defaults to New", afterFirst.every((l) => l.status === "New"));

    const run1 = await runFor(first.json?.runId);
    check("agent_runs row exists", !!run1);
    check("run status ok", run1?.status === "ok", `got ${run1?.status}`);
    check(
      "run counts 2 found / 2 new / 0 duplicate",
      run1?.leadsFound === 2 && run1?.leadsNew === 2 && run1?.leadsDuplicate === 0,
      JSON.stringify({ found: run1?.leadsFound, new: run1?.leadsNew, dup: run1?.leadsDuplicate }),
    );

    /* 2 ---------------------------------------------------- idempotent rerun */
    console.log("\n2. Reposting the same batch creates nothing");
    const second = await post({ region: "UK", agent: "Events", leads: batch("first") }, key);
    check("HTTP 200", second.status === 200, `got ${second.status}`);
    check(
      "found 2, created 0, duplicate 2",
      second.json?.found === 2 && second.json?.created === 0 && second.json?.duplicate === 2,
      JSON.stringify({
        found: second.json?.found,
        created: second.json?.created,
        duplicate: second.json?.duplicate,
      }),
    );
    const afterSecond = await taggedLeads();
    check("still exactly 2 rows", afterSecond.length === 2, `found ${afterSecond.length}`);

    const run2 = await runFor(second.json?.runId);
    check(
      "run counts 2 found / 0 new / 2 duplicate",
      run2?.leadsFound === 2 && run2?.leadsNew === 0 && run2?.leadsDuplicate === 2,
      JSON.stringify({ found: run2?.leadsFound, new: run2?.leadsNew, dup: run2?.leadsDuplicate }),
    );

    /* 3 -------------------------- a decision survives, the facts still refresh */
    console.log("\n3. An approved lead keeps its status while its facts refresh");
    const approvedId = afterSecond[0].id;
    await db
      .update(leads)
      .set({ status: "Approved", statusChangedAt: new Date() })
      .where(eq(leads.id, approvedId));

    const third = await post({ region: "UK", agent: "Events", leads: batch("second") }, key);
    check("HTTP 200", third.status === 200, `got ${third.status}`);
    check(
      "created 0, duplicate 2",
      third.json?.created === 0 && third.json?.duplicate === 2,
      JSON.stringify({ created: third.json?.created, duplicate: third.json?.duplicate }),
    );

    const [approved] = await db.select().from(leads).where(eq(leads.id, approvedId)).limit(1);
    check("status is still Approved", approved?.status === "Approved", `got ${approved?.status}`);
    check("`what` refreshed to revision two", approved?.what.includes("revision second"), approved?.what);
    check("`fit` refreshed Medium to High", approved?.fit === "High", `got ${approved?.fit}`);
    check("statusChangedAt was not cleared", approved?.statusChangedAt !== null);

    /* 4 -------------------------------------------------------- bad requests */
    console.log("\n4. Bad requests are refused, and record no run");
    const runsBeforeBad = runIds.length;

    const badKey = await post({ region: "UK", leads: batch("first") }, "not-the-ingest-key");
    check("wrong x-ingest-key gives 401", badKey.status === 401, `got ${badKey.status}`);

    const noRegion = await post({ agent: "Events", leads: batch("first") }, key);
    check("missing region gives 400", noRegion.status === 400, `got ${noRegion.status}`);

    check(
      "neither refused request opened a run",
      runIds.length === runsBeforeBad,
      `${runIds.length - runsBeforeBad} new run id(s)`,
    );

    const afterBad = await taggedLeads();
    check("no extra rows were written", afterBad.length === 2, `found ${afterBad.length}`);
  } finally {
    /* 5 ------------------------------------------------------------- tidy up */
    console.log("\n5. Cleaning up");
    const removed = await cleanup();
    console.log(`  removed ${removed.leads} test lead(s) and ${removed.runs} agent_runs row(s)`);

    const left = await taggedLeads();
    check("no test rows left behind", left.length === 0, `${left.length} remain`);

    const untaggedAfter = await countUntagged();
    check(
      `existing leads untouched (${untaggedBefore})`,
      untaggedAfter === untaggedBefore,
      `now ${untaggedAfter}`,
    );
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n" + (error instanceof Error ? error.message : String(error)));
  process.exit(1);
});
