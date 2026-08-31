import { NextResponse } from "next/server";
import { buildDigest } from "@/lib/digest";
import { isIsoDate } from "@/lib/dates";

/* What the scanners read at the start of a run, so her verdicts actually
   change what the next run looks for.

     curl -H "x-ingest-key: …" \
       "https://…/api/feedback/digest?agent=Film&region=UK&since=2026-08-01"

   Authenticated with the same INGEST_KEY the scanners post with: same
   principals, same trust boundary. It is listed in PUBLIC_PATHS so the proxy
   lets it through, which means the key check below is the only guard — do not
   remove it.

   The response deliberately carries no contact names, emails or phone numbers.
   That boundary lives in `src/lib/digest.ts`, in the columns it does not
   select. */

export async function GET(request: Request) {
  const key = process.env.INGEST_KEY;
  if (!key) {
    return NextResponse.json({ error: "Digest is not configured" }, { status: 503 });
  }
  if (request.headers.get("x-ingest-key") !== key) {
    return NextResponse.json({ error: "Bad ingest key" }, { status: 401 });
  }

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
