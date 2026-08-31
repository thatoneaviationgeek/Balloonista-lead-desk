import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { AppRole } from "@/auth";
import type { WriteResult } from "./pipeline-writes";

/**
 * Defence in depth for a route handler.
 *
 * `src/proxy.ts` should never let an anonymous request reach a route, but a
 * handler that writes must not serve on the assumption that it ran — the same
 * reasoning as the session check at the top of the leads page.
 */
export type Writer = {
  personId: string;
  email: string | null;
  role: AppRole;
};

type Allowed = { ok: true; writer: Writer };
type Refused = { ok: false; response: NextResponse };

/** Signed in, and not a viewer. Viewers can read the panel but change nothing. */
export async function requireWriter(): Promise<Allowed | Refused> {
  const session = await auth();
  if (!session?.user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Not signed in" }, { status: 401 }),
    };
  }
  if (session.user.role === "viewer") {
    return {
      ok: false,
      response: NextResponse.json({ error: "Viewers cannot change anything" }, { status: 403 }),
    };
  }
  return {
    ok: true,
    writer: {
      personId: session.user.id,
      email: session.user.email ?? null,
      role: session.user.role,
    },
  };
}

/** Body parsing that answers with 400 rather than throwing on malformed JSON. */
export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

/** Turns a write function's result into a response. Keeps the handlers to
 *  auth, parse, call, respond — everything worth testing lives in the
 *  functions in `pipeline-writes.ts`. */
export function respond<T extends object>(result: WriteResult<T>) {
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, ...(result.code ? { code: result.code } : {}) },
      { status: result.status },
    );
  }
  return NextResponse.json({ ok: true, ...result.data });
}

/** Trimmed string, or null when absent or blank. */
export function optionalText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
