import { NextResponse } from "next/server";
import { pullInbox } from "@/lib/ingest-bridge";

/* Vercel Cron calls this every fifteen minutes (see vercel.json) with
   `Authorization: Bearer $CRON_SECRET`, which Vercel sets on its own
   invocations and nobody else can. To run it by hand:

     curl -H "authorization: Bearer $CRON_SECRET" https://…/api/cron/pull-ingest

   The path is in PUBLIC_PATHS so the proxy does not bounce the cron to
   /signin — which means this check is the only guard. Do not remove it.

   Reads the Drive inbox, ingests each file through the same `ingestBatch` the
   POST route uses, and moves files to processed/failed. The response lists
   what happened to each file; the same detail is in `ingest_files`. */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Not configured: set CRON_SECRET" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const result = await pullInbox(10);
  const ok = result.files.filter((f) => f.outcome === "ok").length;
  const failed = result.files.filter((f) => f.outcome === "failed").length;
  const skipped = result.files.filter((f) => f.outcome === "skipped").length;
  return NextResponse.json({ ok: true, seen: result.seen, ingested: ok, failed, skipped, files: result.files });
}
