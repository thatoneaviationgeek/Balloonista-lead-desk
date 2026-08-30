import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { badRequest, optionalText, readJson, requireWriter } from "@/lib/api-auth";
import { isIsoDate } from "@/lib/dates";
import { FOLLOW_UP_STATUSES, type FollowUpStatus } from "@/lib/pipeline";
import { db } from "@/db";
import { followUps } from "@/db/schema";

/* Complete, cancel, reopen or reschedule a follow-up.
   Completing takes it off the Due list without deleting it — the history of
   what was chased and when is the point, so nothing here removes a row. */

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;

  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  const existing = (await db.select().from(followUps).where(eq(followUps.id, id)).limit(1))[0];
  if (!existing) return NextResponse.json({ error: "No such follow-up" }, { status: 404 });

  const patch: Partial<typeof followUps.$inferInsert> = { updatedAt: new Date() };

  if (body.status !== undefined) {
    const status = body.status;
    if (typeof status !== "string" || !(FOLLOW_UP_STATUSES as readonly string[]).includes(status)) {
      return badRequest(`status must be one of: ${FOLLOW_UP_STATUSES.join(", ")}`);
    }
    patch.status = status as FollowUpStatus;
    /* `completedAt` means completed, so only `done` sets it. Cancelling is not
       completing — it is deciding not to, and the distinction is worth keeping
       when someone later asks what actually got chased. */
    if (status === "done") patch.completedAt = new Date();
    if (status === "open") patch.completedAt = null;
  }

  if (body.dueAt !== undefined) {
    if (!isIsoDate(body.dueAt)) return badRequest("dueAt must be a calendar date as YYYY-MM-DD");
    patch.dueAt = body.dueAt;
  }

  if (body.note !== undefined) patch.note = optionalText(body.note);

  if (Object.keys(patch).length === 1) {
    return badRequest("Nothing to change: pass status, dueAt or note");
  }

  const [row] = await db.update(followUps).set(patch).where(eq(followUps.id, id)).returning();
  return NextResponse.json({ ok: true, followUp: row });
}
