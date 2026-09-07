import { NextResponse } from "next/server";
import { checkScannerKey } from "@/lib/ingest-auth";
import { AgentPausedError, ingestBatch, parseIngestBody } from "@/lib/ingest";

/* A batch posted directly, authenticated with INGEST_WRITE_KEY:
     curl -X POST https://…/api/leads/ingest \
       -H "x-ingest-key: $INGEST_WRITE_KEY" -H "content-type: application/json" \
       -d '{"region":"UK","agent":"Film","leads":[…]}'

   The scheduled-task scanners cannot reach this — their runtime is GET-only —
   so in practice it serves local tests and any future scanner that runs
   somewhere with a real HTTP client. The scheduled tasks deliver through the
   Drive drop-box instead (`/api/cron/pull-ingest`). Both paths end in
   `ingestBatch`, so the rules are the same either way: facts refreshed,
   decisions never overwritten. */

export async function POST(request: Request) {
  const refused = checkScannerKey(request, "write");
  if (refused) return refused;

  const raw: unknown = await request.json().catch(() => null);
  const parsed = parseIngestBody(raw);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  try {
    const result = await ingestBatch(parsed.body, { source: "http" });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof AgentPausedError) {
      return NextResponse.json({ error: error.message, code: "paused" }, { status: 409 });
    }
    throw error;
  }
}
