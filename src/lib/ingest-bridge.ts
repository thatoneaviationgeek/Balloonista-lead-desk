/**
 * The drop-box puller.
 *
 * The scanners are Claude scheduled tasks whose runtime can only make plain
 * GETs — no POST, no headers — so they cannot call `/api/leads/ingest`. What
 * they can do is write a file into a Drive folder. So each run writes one JSON
 * file (the same body the ingest route accepts) into `Balloonista Ingest /
 * inbox`, and this pulls the inbox every fifteen minutes, feeds each file to
 * `ingestBatch`, and moves it to `processed` or `failed`. Nothing is deleted.
 *
 * Idempotency is the `ingest_files` primary key. A file's Drive id is inserted
 * with `onConflictDoNothing` *before* the file is read; only the invocation
 * that won the insert goes on to ingest it. Two overlapping crons, a retry, a
 * file that failed to move — all settle to "ingested once". A claim older than
 * thirty minutes still marked `processing` is taken to be a crashed
 * invocation and may be re-claimed.
 *
 * Environment:
 *   INGEST_DRIVE_INBOX_ID / INGEST_DRIVE_PROCESSED_ID / INGEST_DRIVE_FAILED_ID
 *   — the three subfolder ids. Explicit rather than looked up by name, so a
 *   renamed folder cannot silently redirect the flow.
 */
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { ingestFiles } from "@/db/schema";
import { listFolder, moveFile, readFileText, type DriveFile } from "./google-drive";
import { AgentPausedError, ingestBatch, parseIngestBody } from "./ingest";

const STALE_CLAIM_MS = 30 * 60 * 1000;

export function bridgeFolders() {
  const inbox = process.env.INGEST_DRIVE_INBOX_ID;
  const processed = process.env.INGEST_DRIVE_PROCESSED_ID;
  const failed = process.env.INGEST_DRIVE_FAILED_ID;
  if (!inbox || !processed || !failed) {
    throw new Error(
      "Not configured: set INGEST_DRIVE_INBOX_ID, INGEST_DRIVE_PROCESSED_ID and INGEST_DRIVE_FAILED_ID",
    );
  }
  return { inbox, processed, failed };
}

export type PulledFile = {
  fileId: string;
  fileName: string;
  outcome: "ok" | "failed" | "skipped";
  runId?: string;
  created?: number;
  duplicate?: number;
  error?: string;
};

/** Takes ownership of a file, or returns false if another invocation has it.
 *  Fresh files are claimed by insert; a stale `processing` row (a crashed run)
 *  is re-claimed by a guarded update. Both are single statements that let the
 *  database decide — no read-then-decide. */
async function claim(file: DriveFile): Promise<boolean> {
  const inserted = await db
    .insert(ingestFiles)
    .values({ driveFileId: file.id, fileName: file.name })
    .onConflictDoNothing()
    .returning({ id: ingestFiles.driveFileId });
  if (inserted.length) return true;

  const reclaimed = await db
    .update(ingestFiles)
    .set({ claimedAt: new Date(), error: null })
    .where(
      and(
        eq(ingestFiles.driveFileId, file.id),
        eq(ingestFiles.status, "processing"),
        lt(ingestFiles.claimedAt, new Date(Date.now() - STALE_CLAIM_MS)),
      ),
    )
    .returning({ id: ingestFiles.driveFileId });
  return reclaimed.length > 0;
}

/** Processes one claimed file end to end. Never throws: every outcome is
 *  written to `ingest_files` and the file is moved somewhere. */
async function processFile(file: DriveFile, folders: ReturnType<typeof bridgeFolders>): Promise<PulledFile> {
  const base = { fileId: file.id, fileName: file.name };
  try {
    const text = await readFileText(file);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("not valid JSON");
    }
    const parsed = parseIngestBody(raw);
    if (!parsed.ok) throw new Error(parsed.error);

    const result = await ingestBatch(parsed.body, {
      source: "drive",
      fileId: file.id,
      fileName: file.name,
    });

    await db
      .update(ingestFiles)
      .set({ status: "ok", runId: result.runId, finishedAt: new Date() })
      .where(eq(ingestFiles.driveFileId, file.id));
    await moveFile(file.id, folders.inbox, folders.processed).catch((e: unknown) => {
      /* Ingested but not moved: the claim row means it will not be ingested
         again, so this is untidy rather than wrong. Record it and move on. */
      console.warn(`[pull-ingest] ingested ${file.name} but could not move it: ${String(e)}`);
    });
    return { ...base, outcome: "ok", ...result };
  } catch (error) {
    const message =
      error instanceof AgentPausedError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    await db
      .update(ingestFiles)
      .set({ status: "failed", error: message.slice(0, 1000), finishedAt: new Date() })
      .where(eq(ingestFiles.driveFileId, file.id));
    await moveFile(file.id, folders.inbox, folders.failed).catch((e: unknown) => {
      console.warn(`[pull-ingest] could not move failed file ${file.name}: ${String(e)}`);
    });
    return { ...base, outcome: "failed", error: message };
  }
}

/** One pull of the inbox. Bounded so a backlog is worked down over several
 *  invocations rather than one long one. */
export async function pullInbox(limit = 10): Promise<{ seen: number; files: PulledFile[] }> {
  const folders = bridgeFolders();
  const listing = await listFolder(folders.inbox, limit);
  const files: PulledFile[] = [];
  for (const file of listing) {
    if (!(await claim(file))) {
      files.push({ fileId: file.id, fileName: file.name, outcome: "skipped" });
      continue;
    }
    files.push(await processFile(file, folders));
  }
  return { seen: listing.length, files };
}
