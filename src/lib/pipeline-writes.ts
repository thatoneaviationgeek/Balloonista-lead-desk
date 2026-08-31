/**
 * Every write in the Phase 2A pipeline, as plain functions.
 *
 * The route handlers are a thin auth-and-parse layer over these: they check the
 * session, hand the body across, and turn the result into a response. Keeping
 * the logic here is what makes it testable without minting a session cookie —
 * see `src/scripts/check-pipeline.ts`.
 *
 * Server only: this imports the database. Do not import it from a client
 * component — `src/lib/pipeline.ts` holds the shapes and labels that are safe
 * to share.
 *
 * House rule, from AGENTS.md: no read-then-decide-then-write. neon-http has no
 * interactive transactions, so each function reads what it needs, mints ids with
 * randomUUID(), and commits every write in a single `db.batch()`.
 */
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { isIsoDate, todayInLondon } from "./dates";
import {
  ACTIVITY_KINDS,
  FEEDBACK_REASONS,
  FEEDBACK_VERDICTS,
  FOLLOW_UP_STATUSES,
  contactDedupeKey,
  looksLikeEmail,
  organisationDedupeKey,
  type ActivityKind,
  type FeedbackReason,
  type FeedbackVerdict,
  type FollowUpStatus,
} from "./pipeline";
import { db } from "@/db";
import {
  activities,
  contacts,
  followUps,
  leadFeedback,
  leadEvents,
  leads,
  organisations,
  people,
} from "@/db/schema";

export type Writer = { personId: string; email: string | null };

export type WriteResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; code?: string };

type Write = Parameters<typeof db.batch>[0][number];

const fail = (status: number, error: string, code?: string): WriteResult<never> => ({
  ok: false,
  status,
  error,
  ...(code ? { code } : {}),
});

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/* ------------------------------------------------------------ log activity */

export type LogActivityResult = {
  activityId: string;
  organisationId: string | null;
  contactId: string | null;
  leadApproved: boolean;
};

export async function logActivity(
  writer: Writer,
  body: Record<string, unknown>,
): Promise<WriteResult<LogActivityResult>> {
  const kind = body.kind;
  if (typeof kind !== "string" || !(ACTIVITY_KINDS as readonly string[]).includes(kind)) {
    return fail(400, `kind must be one of: ${ACTIVITY_KINDS.join(", ")}`);
  }

  const occurredAt = body.occurredAt;
  if (!isIsoDate(occurredAt)) return fail(400, "occurredAt must be a calendar date as YYYY-MM-DD");
  /* Today in London, not the server's today — see src/lib/dates.ts. */
  if (occurredAt > todayInLondon()) {
    return fail(400, "occurredAt cannot be in the future; this records what has happened");
  }

  const summary = text(body.summary);
  if (!summary) return fail(400, "summary is required — one line on what happened");

  const now = new Date();
  const writes: Write[] = [];

  /* --- organisation --- */
  let organisationId = text(body.organisationId);
  const newOrganisation = record(body.newOrganisation);

  if (!organisationId && newOrganisation) {
    const name = text(newOrganisation.name);
    if (!name) return fail(400, "newOrganisation.name is required");
    const region = newOrganisation.region === "Dubai" ? "Dubai" : "UK";
    const dedupeKey = organisationDedupeKey(name);

    const existing = (
      await db
        .select({ id: organisations.id })
        .from(organisations)
        .where(and(eq(organisations.region, region), eq(organisations.dedupeKey, dedupeKey)))
        .limit(1)
    )[0];

    if (existing) {
      organisationId = existing.id;
    } else {
      organisationId = randomUUID();
      writes.push(db.insert(organisations).values({ id: organisationId, region, dedupeKey, name }));
    }
  } else if (organisationId) {
    const found = (
      await db
        .select({ id: organisations.id })
        .from(organisations)
        .where(eq(organisations.id, organisationId))
        .limit(1)
    )[0];
    if (!found) return fail(404, "No such organisation");
  }

  /* --- contact --- */
  let contactId = text(body.contactId);
  const newContact = record(body.newContact);

  if (contactId) {
    const found = (
      await db
        .select({ id: contacts.id, organisationId: contacts.organisationId })
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1)
    )[0];
    if (!found) return fail(404, "No such contact");
    /* The contact's own organisation wins, and is denormalised onto the activity
       deliberately: it records where they worked at the time, not where they
       work now. See the comment on activities.organisationId. */
    organisationId = found.organisationId;
  } else if (newContact) {
    if (!organisationId) {
      return fail(400, "A new contact needs an organisation: pass organisationId or newOrganisation");
    }
    const name = text(newContact.name);
    const email = text(newContact.email);
    if (!name && !email) return fail(400, "newContact needs at least a name or an email");
    if (email && !looksLikeEmail(email)) {
      return fail(
        400,
        "newContact.email does not look like an address. If there is no address, put the note in newContact.gap instead — that is what it is for",
      );
    }

    const dedupeKey = contactDedupeKey({ email, name });
    const existing = (
      await db
        .select({ id: contacts.id })
        .from(contacts)
        .where(and(eq(contacts.organisationId, organisationId), eq(contacts.dedupeKey, dedupeKey)))
        .limit(1)
    )[0];

    if (existing) {
      contactId = existing.id;
    } else {
      contactId = randomUUID();
      writes.push(
        db.insert(contacts).values({
          id: contactId,
          organisationId,
          dedupeKey,
          name,
          jobTitle: text(newContact.jobTitle),
          email,
          phone: text(newContact.phone),
          gap: text(newContact.gap),
        }),
      );
    }
  }

  /* --- lead --- */
  const leadId = text(body.leadId);
  let approving = false;

  if (leadId) {
    const lead = (
      await db
        .select({ id: leads.id, status: leads.status })
        .from(leads)
        .where(eq(leads.id, leadId))
        .limit(1)
    )[0];
    if (!lead) return fail(404, "No such lead");

    if (lead.status === "New") {
      /* Logging contact on a lead nobody has triaged would leave it "awaiting
         review" with an email already sent against it. Approving is the honest
         resolution, but it is her decision and must be explicit — so the caller
         has to say so, and the UI turns this into a confirmation rather than
         moving her lead behind her back. Demanding it here, rather than trusting
         the UI to ask, is what stops a later caller creating a lead that has
         been emailed but never triaged. */
      if (body.approveLead !== true) {
        return fail(
          409,
          "This lead is still New. Logging contact will mark it Approved.",
          "lead_approval_required",
        );
      }
      approving = true;
    }
  }

  if (!leadId && !organisationId && !contactId) {
    return fail(400, "An activity must be attached to a lead, an organisation or a contact");
  }

  if (approving && leadId) {
    writes.push(
      db
        .update(leads)
        .set({
          status: "Approved",
          statusChangedAt: now,
          statusChangedBy: writer.personId || null,
          updatedAt: now,
        })
        .where(eq(leads.id, leadId)),
    );
    writes.push(
      db.insert(leadEvents).values({
        leadId,
        actorId: writer.personId || null,
        actorEmail: writer.email,
        fromStatus: "New",
        toStatus: "Approved",
        note: "Approved when contact was logged against it",
      }),
    );
  }

  const activityId = randomUUID();
  writes.push(
    db.insert(activities).values({
      id: activityId,
      kind: kind as ActivityKind,
      occurredAt,
      summary,
      actorId: writer.personId || null,
      leadId,
      organisationId,
      contactId,
    }),
  );

  await db.batch(writes as [Write, ...Write[]]);

  return { ok: true, data: { activityId, organisationId, contactId, leadApproved: approving } };
}

/* --------------------------------------------------------- create follow-up */

/** Resolves the three links, carrying the organisation alongside any contact. */
async function resolveLinks(body: Record<string, unknown>) {
  const leadId = text(body.leadId);
  let organisationId = text(body.organisationId);
  const contactId = text(body.contactId);

  if (leadId) {
    const found = (
      await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).limit(1)
    )[0];
    if (!found) return { error: fail(404, "No such lead") };
  }

  if (contactId) {
    const found = (
      await db
        .select({ id: contacts.id, organisationId: contacts.organisationId })
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1)
    )[0];
    if (!found) return { error: fail(404, "No such contact") };
    /* Always carry the organisation alongside the contact. This is what lets a
       contact be hard-deleted later without the SET NULL tripping
       `follow_ups_has_link` — see the CHECK comments in src/db/schema.ts. */
    organisationId = found.organisationId;
  } else if (organisationId) {
    const found = (
      await db
        .select({ id: organisations.id })
        .from(organisations)
        .where(eq(organisations.id, organisationId))
        .limit(1)
    )[0];
    if (!found) return { error: fail(404, "No such organisation") };
  }

  if (!leadId && !organisationId && !contactId) {
    return {
      error: fail(400, "A follow-up must be attached to a lead, an organisation or a contact"),
    };
  }

  return { links: { leadId, organisationId, contactId } };
}

export async function createFollowUp(
  writer: Writer,
  body: Record<string, unknown>,
): Promise<WriteResult<{ id: string }>> {
  const dueAt = body.dueAt;
  if (!isIsoDate(dueAt)) return fail(400, "dueAt must be a calendar date as YYYY-MM-DD");
  /* A due date in the past is allowed on purpose: overdue is a real state, and
     she may well be recording something she already meant to chase. */

  const resolved = await resolveLinks(body);
  if (resolved.error) return resolved.error;

  /* Hers unless she says otherwise — the Due view defaults to the signed-in
     person, so an unassigned follow-up would vanish from the screen she opens. */
  let assigneeId: string | null = text(body.assigneeId) ?? writer.personId ?? null;
  if (assigneeId) {
    const found = (
      await db.select({ id: people.id }).from(people).where(eq(people.id, assigneeId)).limit(1)
    )[0];
    if (!found) return fail(404, "No such person");
  } else {
    assigneeId = null;
  }

  const id = randomUUID();
  await db.insert(followUps).values({
    id,
    dueAt,
    note: text(body.note),
    assigneeId,
    ...resolved.links,
  });

  return { ok: true, data: { id } };
}

/* --------------------------------------------------------- update follow-up */

export type UpdateFollowUpResult = { id: string; nextId: string | null };

export async function updateFollowUp(
  writer: Writer,
  id: string,
  body: Record<string, unknown>,
): Promise<WriteResult<UpdateFollowUpResult>> {
  const existing = (await db.select().from(followUps).where(eq(followUps.id, id)).limit(1))[0];
  if (!existing) return fail(404, "No such follow-up");

  const now = new Date();
  const patch: Partial<typeof followUps.$inferInsert> = { updatedAt: now };

  if (body.status !== undefined) {
    const status = body.status;
    if (typeof status !== "string" || !(FOLLOW_UP_STATUSES as readonly string[]).includes(status)) {
      return fail(400, `status must be one of: ${FOLLOW_UP_STATUSES.join(", ")}`);
    }
    patch.status = status as FollowUpStatus;
    /* `completedAt` means completed, so only `done` sets it. Cancelling is not
       completing — it is deciding not to — and the distinction is worth keeping
       when someone later asks what actually got chased. */
    if (status === "done") patch.completedAt = now;
    if (status === "open") patch.completedAt = null;
  }

  if (body.dueAt !== undefined) {
    if (!isIsoDate(body.dueAt)) return fail(400, "dueAt must be a calendar date as YYYY-MM-DD");
    patch.dueAt = body.dueAt;
  }

  if (body.note !== undefined) patch.note = text(body.note);

  /* Completing one offers to set the next, in the same step. Her real loop is
     follow up, no answer, follow up again in two weeks — and if completing only
     removed it from the list she would have to remember to make a replacement,
     which is exactly what the spreadsheet already failed at. The next one
     inherits this one's links, so the chain stays attached to the same lead or
     organisation. Offered, never imposed: no `next`, no replacement. */
  const next = record(body.next);
  let nextId: string | null = null;
  const writes: Write[] = [];

  if (next) {
    if (!isIsoDate(next.dueAt)) return fail(400, "next.dueAt must be a calendar date as YYYY-MM-DD");
    nextId = randomUUID();
    writes.push(
      db.insert(followUps).values({
        id: nextId,
        dueAt: next.dueAt,
        note: text(next.note),
        assigneeId: existing.assigneeId ?? writer.personId ?? null,
        leadId: existing.leadId,
        organisationId: existing.organisationId,
        contactId: existing.contactId,
      }),
    );
  }

  if (Object.keys(patch).length === 1 && !next) {
    return fail(400, "Nothing to change: pass status, dueAt, note or next");
  }

  writes.unshift(db.update(followUps).set(patch).where(eq(followUps.id, id)));
  await db.batch(writes as [Write, ...Write[]]);

  return { ok: true, data: { id, nextId } };
}

/* ------------------------------------------------------------- lead feedback */

export async function recordFeedback(
  writer: Writer,
  leadId: string,
  body: Record<string, unknown>,
): Promise<WriteResult<{ id: string }>> {
  if (!writer.personId) return fail(403, "No person record for this session");

  const verdict = body.verdict;
  if (typeof verdict !== "string" || !(FEEDBACK_VERDICTS as readonly string[]).includes(verdict)) {
    return fail(400, `verdict must be one of: ${FEEDBACK_VERDICTS.join(", ")}`);
  }

  const reason = text(body.reason);
  if (reason && !(FEEDBACK_REASONS as readonly string[]).includes(reason)) {
    return fail(400, `reason must be one of: ${FEEDBACK_REASONS.join(", ")}`);
  }
  /* Mirrors the `lead_feedback_reason_when_not_useful` CHECK, so the caller gets
     a sentence rather than a constraint violation. Useful is never asked to
     justify itself — that is the answer we want more of. */
  if (verdict === "not_useful" && !reason) {
    return fail(400, `Not useful needs a reason: one of ${FEEDBACK_REASONS.join(", ")}`);
  }

  const lead = (
    await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).limit(1)
  )[0];
  if (!lead) return fail(404, "No such lead");

  const note = text(body.note);
  const now = new Date();

  /* One row per lead per person, and updatable — she is allowed to change her
     mind. The unique index on (lead_id, actor_id) is the conflict target. */
  const [row] = await db
    .insert(leadFeedback)
    .values({
      leadId,
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
    .returning({ id: leadFeedback.id });

  return { ok: true, data: { id: row.id } };
}
