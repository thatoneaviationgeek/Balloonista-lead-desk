import { NextResponse } from "next/server";

/**
 * The scanners' credential, split by what it is for.
 *
 * `INGEST_KEY` used to do both jobs. Once the digest existed, that single key
 * both wrote leads and read Aurelija's free-text notes — and it lives in plain
 * text inside four scheduled-task prompts, where anyone who can open the task
 * can read it. Posting findings and reading feedback are different privileges
 * and now need different keys:
 *
 *   INGEST_WRITE_KEY   POST /api/leads/ingest
 *   INGEST_READ_KEY    GET  /api/feedback/digest
 *
 * `INGEST_KEY` is still accepted as a fallback so nothing breaks between this
 * shipping and the new variables being set, and a warning is logged whenever it
 * is used. Remove it from the environment once both replacements are in place —
 * while it is set, it grants both privileges and the split is decorative.
 */
type Purpose = "write" | "read";

const VAR: Record<Purpose, string> = {
  write: "INGEST_WRITE_KEY",
  read: "INGEST_READ_KEY",
};

/** Returns a response to send back, or null when the caller may proceed. */
export function checkScannerKey(request: Request, purpose: Purpose): NextResponse | null {
  const specific = process.env[VAR[purpose]];
  const legacy = process.env.INGEST_KEY;
  const expected = specific ?? legacy;

  if (!expected) {
    return NextResponse.json(
      { error: `Not configured: set ${VAR[purpose]}` },
      { status: 503 },
    );
  }
  if (!specific && legacy) {
    console.warn(
      `[scanner-auth] ${VAR[purpose]} is not set; falling back to INGEST_KEY. ` +
        `Set ${VAR[purpose]} and remove INGEST_KEY — while it is set it grants both ` +
        `write and read, which is the thing the split was meant to stop.`,
    );
  }

  const offered = request.headers.get("x-ingest-key");
  /* Compared with a plain !== rather than a timing-safe compare on purpose:
     these are long random bearer tokens over TLS, not short secrets, and a
     remote timing attack on string comparison is not a realistic route in. */
  if (offered !== expected) {
    return NextResponse.json({ error: "Bad ingest key" }, { status: 401 });
  }
  return null;
}
