import { NextResponse } from "next/server";
import { buildDigest } from "@/lib/digest";
import { isIsoDate } from "@/lib/dates";
import { checkScannerKey } from "@/lib/ingest-auth";

/* What the scanners read at the start of a run, so her verdicts actually
   change what the next run looks for.

     curl -H "x-ingest-key: $INGEST_READ_KEY" \
       "https://…/api/feedback/digest?agent=Film&region=UK&since=2026-08-01"

   Authenticated with INGEST_READ_KEY — deliberately not the key the scanners
   post with. Reading her notes and writing leads are different privileges, and
   one key for both meant four scheduled-task prompts each carried more access
   than any of them needed. It is listed in PUBLIC_PATHS so the proxy
   lets it through, which means the key check below is the only guard — do not
   remove it.

   The response deliberately carries no contact names, emails or phone numbers.
   That boundary lives in `src/lib/digest.ts`, in the columns it does not
   select. */

export async function GET(request: Request) {
  const refused = checkScannerKey(request, "read");
  if (refused) return refused;

  const params = new URL(request.url).searchParams;

  const regionRaw = params.get("region");
  if (regionRaw && regionRaw !== "UK" && regionRaw !== "Dubai") {
    return NextResponse.json({ error: "region must be UK or Dubai" }, { status: 400 });
  }

  const since = params.get("since");
  if (since && !isIsoDate(since)) {
    return NextResponse.json({ error: "since must be a date as YYYY-MM-DD" }, { status: 400 });
  }

  const digest = await buildDigest({
    agent: params.get("agent"),
    region: regionRaw as "UK" | "Dubai" | null,
    since,
  });

  return NextResponse.json(digest);
}
