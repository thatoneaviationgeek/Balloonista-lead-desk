import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { badRequest, optionalText, readJson, requireWriter } from "@/lib/api-auth";
import {
  FEEDBACK_REASONS,
  FEEDBACK_VERDICTS,
  type FeedbackReason,
  type FeedbackVerdict,
} from "@/lib/pipeline";
import { db } from "@/db";
import { leadFeedback, leads } from "@/db/schema";

/* Her verdict on whether a scanner lead was worth having.
   Not useful has to say why, because free text alone drifts to "no" and "not
   right", which cannot be aggregated into anything a scanner prompt can use.
   Useful asks for nothing — never make her justify a yes, that is the answer we
   want more of. */

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;
  const { writer } = gate;

  if (!writer.personId) {
    return NextResponse.json({ error: "No person record for this session" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  const verdict = body.verdict;
  if (typeof verdict !== "string" || !(FEEDBACK_VERDICTS as readonly string[]).includes(verdict)) {
    return badRequest(`verdict must be one of: ${FEEDBACK_VERDICTS.join(", ")}`);
  }

  const reason = optionalText(body.reason);
  if (reason && !(FEEDBACK_REASONS as readonly string[]).includes(reason)) {
    return badRequest(`reason must be one of: ${FEEDBACK_REASONS.join(", ")}`);
  }
  /* Mirrors the `lead_feedback_reason_when_not_useful` CHECK, so the caller gets
     a sentence rather than a constraint violation. */
  if (verdict === "not_useful" && !reason) {
    return badRequest(`Not useful needs a reason: one of ${FEEDBACK_REASONS.join(", ")}`);
  }

  const lead = (await db.select({ id: leads.id }).from(leads).where(eq(leads.id, id)).limit(1))[0];
  if (!lead) return NextResponse.json({ error: "No such lead" }, { status: 404 });

  const note = optionalText(body.note);
  const now = new Date();

  /* One row per lead per person, and updatable — she is allowed to change her
     mind. The unique index on (lead_id, actor_id) is the conflict target. */
  const [row] = await db
    .insert(leadFeedback)
    .values({
      leadId: id,
      actorId: writer.personId,
      verdict: verdict as FeedbackVerdict,
      reason: (reason as FeedbackReason | null) ?? null,
      note,
    })
    .onConflictDoUpdate({
      target: [leadFeedback.leadId, leadFeedback.actorId],
      set: {
        verdict: verdict as FeedbackVerdict,
        /* Cleared when she switches to useful, so a stale "wrong sector" cannot
           linger against a verdict that no longer has a reason. */
        reason: (reason as FeedbackReason | null) ?? null,
        note,
        updatedAt: now,
      },
    })
    .returning();

  return NextResponse.json({ ok: true, feedback: row });
}
