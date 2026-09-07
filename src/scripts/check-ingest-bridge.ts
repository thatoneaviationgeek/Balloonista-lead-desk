/**
 * Prove the drop-box bridge.
 *
 *   npx tsx src/scripts/check-ingest-bridge.ts            library only
 *   npx tsx src/scripts/check-ingest-bridge.ts --drive    also round-trips a real file
 *
 * The first form needs only DATABASE_URL and runs against the library
 * directly: `parseIngestBody` on good and bad envelopes, `ingestBatch` on a
 * tagged synthetic batch twice (created then duplicate), the paused flag
 * refusing a batch before it writes anything, and — the rule that matters —
 * a status set by hand surviving a rerun.
 *
 * `--drive` additionally needs the service-account and folder variables. It
 * writes a fixture file to the current directory and asks you to upload it
 * into the Drive `inbox` yourself — a service account has no storage quota,
 * so it cannot plant the file, which is also why the real scanners write
 * through the Drive connector as a person. It then calls `pullInbox` twice
 * and checks that the file was ingested exactly once and ended up in
 * `processed`. Run it against a scratch Neon branch, and only against an
 * inbox that holds nothing real: the pull will ingest whatever it finds
 * there, and it moves files.
 *
 * Same discipline as the other harnesses: everything written is tagged,
 * cleanup runs in a `finally`, and the deletes refuse anything untagged. No
 * company, person or address is invented — the contact is a `GAP — …` line.
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: [".env.local", ".env"], quiet: true });
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "../db";
import { agentRuns, agentSettings, ingestFiles, leads } from "../db/schema";
import { AgentPausedError, ingestBatch, parseIngestBody } from "../lib/ingest";

const TAG = `test-bridge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const AGENT = `TestBridge-${TAG}`;
const withDrive = process.argv.includes("--drive");

function waitForEnter(): Promise<void> {
  return new Promise((done) => {
    process.stdin.resume();
    process.stdin.once("data", () => {
      process.stdin.pause();
      done();
    });
  });
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
}

function batch(revision: "first" | "second") {
  return {
    region: "UK" as const,
    agent: AGENT,
    meta: { revision },
    leads: [
      {
        id: `${TAG}-a`,
        title: `TEST ROW — bridge harness ${TAG} (safe to delete)`,
        fit: revision === "second" ? "High" : "Medium",
        what: `Synthetic row written by check-ingest-bridge.ts, revision ${revision}.`,
        where: "TEST — no location",
        contact: "GAP — synthetic test row, not a real contact",
      },
    ],
  };
}

async function main() {
  console.log(`tag : ${TAG}\n`);
  const runIds: string[] = [];
  const fileIds: string[] = [];
  let fixturePath: string | null = null;

  try {
    console.log("1. parseIngestBody");
    check("rejects a non-object", !parseIngestBody("nope").ok);
    check("rejects a missing region", !parseIngestBody({ leads: [] }).ok);
    check("rejects leads that is not an array", !parseIngestBody({ region: "UK", leads: "x" }).ok);
    const ok = parseIngestBody({ region: "Dubai", leads: [{ agent: "Film", title: "t" }] });
    check("accepts a minimal body", ok.ok);
    check("takes the agent from the first lead when the envelope has none",
      ok.ok && ok.body.agent === "Film", ok.ok ? ok.body.agent : "");
    const withMeta = parseIngestBody({ region: "UK", agent: "X", leads: [], meta: { a: 1 } });
    check("keeps meta when it is an object", withMeta.ok && withMeta.body.meta?.a === 1);
    const emptyAllowed = parseIngestBody({ region: "UK", agent: "X", leads: [] });
    check("an empty run is still a valid run", emptyAllowed.ok);

    console.log("\n2. ingestBatch, first pass");
    const first = await ingestBatch(batch("first"), { source: "http" });
    runIds.push(first.runId);
    check("created 1, duplicate 0", first.created === 1 && first.duplicate === 0, JSON.stringify(first));
    const [lead] = await db.select().from(leads).where(eq(leads.dedupeKey, `${TAG}-a`)).limit(1);
    check("the lead is in the database", !!lead);
    if (!lead) throw new Error("cannot continue");
    const [run] = await db.select().from(agentRuns).where(eq(agentRuns.id, first.runId)).limit(1);
    check("run recorded as ok with origin in meta",
      run?.status === "ok" && (run.meta as { source?: string })?.source === "http",
      JSON.stringify(run?.meta));

    console.log("\n3. A person decides, then the scanner reruns");
    await db.update(leads).set({ status: "Approved", statusChangedAt: new Date() }).where(eq(leads.id, lead.id));
    const second = await ingestBatch(batch("second"), {
      source: "drive", fileId: `${TAG}-fake`, fileName: `run-${TAG}.json`,
    });
    runIds.push(second.runId);
    check("created 0, duplicate 1", second.created === 0 && second.duplicate === 1, JSON.stringify(second));
    const [after] = await db.select().from(leads).where(eq(leads.id, lead.id)).limit(1);
    check("`fit` refreshed Medium to High", after.fit === "High", after.fit);
    check("`what` moved to revision two", after.what.includes("revision second"));
    check("status is still Approved", after.status === "Approved", after.status);
    check("statusChangedAt was not cleared", after.statusChangedAt !== null);

    console.log("\n4. The pause flag");
    await db.insert(agentSettings).values({ agent: AGENT, region: "UK", paused: true, note: "harness" });
    const runsBefore = (await db.select({ id: agentRuns.id }).from(agentRuns).where(eq(agentRuns.agent, AGENT))).length;
    let refused = false;
    try {
      await ingestBatch(batch("second"), { source: "http" });
    } catch (e) {
      refused = e instanceof AgentPausedError;
    }
    check("a paused agent is refused with AgentPausedError", refused);
    const runsAfter = (await db.select({ id: agentRuns.id }).from(agentRuns).where(eq(agentRuns.agent, AGENT))).length;
    check("and no run row was written", runsAfter === runsBefore, `${runsBefore} → ${runsAfter}`);
    await db.delete(agentSettings).where(and(eq(agentSettings.agent, AGENT), eq(agentSettings.region, "UK")));

    if (withDrive) {
      console.log("\n5. Drive round trip");
      const { listFolder } = await import("../lib/google-drive");
      const { bridgeFolders, pullInbox } = await import("../lib/ingest-bridge");
      const folders = bridgeFolders();
      const fixtureName = `run-testbridge-uk-${TAG}.json`;
      fixturePath = resolve(fixtureName);
      writeFileSync(fixturePath, JSON.stringify(batch("first"), null, 2));
      console.log(`  Fixture written to ${fixturePath}`);
      console.log("  Upload that file into the Drive 'inbox' folder (drag it in, or New → File upload),");
      console.log("  wait for the upload to finish, then press Enter here.");
      await waitForEnter();
      const fixture = (await listFolder(folders.inbox, 50)).find((f) => f.name === fixtureName);
      check("fixture visible in inbox", !!fixture, fixture ? `${fixture.id} (${fixture.mimeType})` : "not found — did the upload finish?");
      if (!fixture) throw new Error("cannot continue without the fixture");
      fileIds.push(fixture.id);

      const pull1 = await pullInbox(10);
      const mine = pull1.files.find((f) => f.fileId === fixture.id);
      check("pull picked the fixture up", !!mine, JSON.stringify(pull1.files.map((f) => [f.fileName, f.outcome])));
      check("and ingested it", mine?.outcome === "ok", mine?.error ?? "");
      if (mine?.runId) runIds.push(mine.runId);

      const pull2 = await pullInbox(10);
      const again = pull2.files.find((f) => f.fileId === fixture.id);
      check("a second pull does not see it in the inbox", !again, again ? again.outcome : "");
      const inProcessed = (await listFolder(folders.processed, 50)).some((f) => f.id === fixture.id);
      check("it is now in processed", inProcessed);
      const [row] = await db.select().from(ingestFiles).where(eq(ingestFiles.driveFileId, fixture.id)).limit(1);
      check("ingest_files records ok with a run id", row?.status === "ok" && !!row.runId, JSON.stringify(row));
    } else {
      console.log("\n5. Drive round trip skipped (pass --drive with the service-account variables set)");
    }
  } finally {
    console.log("\n6. Cleaning up");
    const tl = await db.select({ id: leads.id, k: leads.dedupeKey }).from(leads).where(like(leads.dedupeKey, `${TAG}%`));
    if (tl.some((r) => !r.k.startsWith(TAG))) throw new Error("refusing to delete untagged leads");
    if (tl.length) await db.delete(leads).where(like(leads.dedupeKey, `${TAG}%`));
    if (fileIds.length) await db.delete(ingestFiles).where(inArray(ingestFiles.driveFileId, fileIds));
    await db.delete(agentSettings).where(eq(agentSettings.agent, AGENT));
    await db.delete(agentRuns).where(eq(agentRuns.agent, AGENT));
    console.log(`  removed ${tl.length} lead(s), ${fileIds.length} ingest_files row(s), runs for ${AGENT}`);
    if (fixturePath && existsSync(fixturePath)) unlinkSync(fixturePath);
    if (fileIds.length) {
      console.log("  NOTE: the fixture file is left in Drive's processed (or failed) folder — delete it by hand if you like.");
    }
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n" + (error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exit(1);
});
