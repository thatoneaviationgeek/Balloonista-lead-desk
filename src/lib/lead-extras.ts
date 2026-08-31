/**
 * The pipeline material that hangs off a lead — its activity history, its
 * soonest open follow-up, and this person's verdict on it.
 *
 * Server only. Fetched in three queries for the whole page rather than one per
 * card, so a hundred leads stay three round trips.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { LeadActivity, LeadFeedbackView, LeadFollowUp } from "./leads";
import { db } from "@/db";
import { activities, contacts, followUps, leadFeedback, organisations, people } from "@/db/schema";

export type LeadExtras = {
  activities: Map<string, LeadActivity[]>;
  followUp: Map<string, LeadFollowUp>;
  feedback: Map<string, LeadFeedbackView>;
};

const empty: LeadExtras = { activities: new Map(), followUp: new Map(), feedback: new Map() };

export async function loadLeadExtras(leadIds: string[], personId: string): Promise<LeadExtras> {
  if (leadIds.length === 0) return empty;

  const [actRows, fuRows, fbRows] = await Promise.all([
    db
      .select({
        id: activities.id,
        leadId: activities.leadId,
        kind: activities.kind,
        occurredAt: activities.occurredAt,
        summary: activities.summary,
        actorEmail: people.email,
        contactName: contacts.name,
        organisationName: organisations.name,
      })
      .from(activities)
      .leftJoin(people, eq(activities.actorId, people.id))
      .leftJoin(contacts, eq(activities.contactId, contacts.id))
      .leftJoin(organisations, eq(activities.organisationId, organisations.id))
      .where(inArray(activities.leadId, leadIds))
      /* Newest first, which is how the card shows it. */
      .orderBy(desc(activities.occurredAt), desc(activities.createdAt)),

    db
      .select({
        id: followUps.id,
        leadId: followUps.leadId,
        dueAt: followUps.dueAt,
        note: followUps.note,
      })
      .from(followUps)
      .where(and(inArray(followUps.leadId, leadIds), eq(followUps.status, "open")))
      /* Soonest first: the chip shows the next thing owed, not the last one set. */
      .orderBy(asc(followUps.dueAt)),

    db
      .select({
        leadId: leadFeedback.leadId,
        verdict: leadFeedback.verdict,
        reason: leadFeedback.reason,
        note: leadFeedback.note,
      })
      .from(leadFeedback)
      .where(and(inArray(leadFeedback.leadId, leadIds), eq(leadFeedback.actorId, personId))),
  ]);

  const out: LeadExtras = { activities: new Map(), followUp: new Map(), feedback: new Map() };

  for (const r of actRows) {
    if (!r.leadId) continue;
    const list = out.activities.get(r.leadId) ?? [];
    list.push({
      id: r.id,
      kind: r.kind,
      occurredAt: r.occurredAt,
      summary: r.summary,
      actorEmail: r.actorEmail,
      contactName: r.contactName,
      organisationName: r.organisationName,
    });
    out.activities.set(r.leadId, list);
  }

  for (const r of fuRows) {
    /* Ordered soonest first, so the first one seen for a lead is the one to show. */
    if (r.leadId && !out.followUp.has(r.leadId)) {
      out.followUp.set(r.leadId, { id: r.id, dueAt: r.dueAt, note: r.note });
    }
  }

  for (const r of fbRows) {
    out.feedback.set(r.leadId, { verdict: r.verdict, reason: r.reason, note: r.note });
  }

  return out;
}
