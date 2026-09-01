/**
 * Reads for the organisations screen — the relationships she works over months
 * and years, as distinct from the one-off moments the scanners find.
 *
 * Server only. Four queries for the whole page rather than one per row.
 */
import { asc, desc, eq } from "drizzle-orm";
import type { ActivityKind } from "./pipeline";
import { db } from "@/db";
import { activities, contacts, followUps, organisations, people } from "@/db/schema";

export type OrgContact = {
  id: string;
  name: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  /* The honest no-address-found note. Kept as a stated gap, never blanked. */
  gap: string | null;
};

export type OrgActivity = {
  id: string;
  kind: ActivityKind;
  occurredAt: string;
  summary: string;
  actorEmail: string | null;
  contactName: string | null;
};

export type OrganisationView = {
  id: string;
  name: string;
  sector: string | null;
  tier: number | null;
  relationship: string | null;
  contactStatus: "not_contacted" | "initial_email_sent" | "have_a_contact";
  referralPotential: "high" | "medium" | "low" | "unknown";
  website: string | null;
  location: string | null;
  region: "UK" | "Dubai";
  estimatedValuePence: number | null;
  notes: string | null;
  contacts: OrgContact[];
  activities: OrgActivity[];
  followUp: { id: string; dueAt: string; note: string | null } | null;
};

export async function listOrganisations(): Promise<OrganisationView[]> {
  const [orgRows, contactRows, activityRows, followUpRows] = await Promise.all([
    db.select().from(organisations).orderBy(asc(organisations.name)),

    db
      .select({
        id: contacts.id,
        organisationId: contacts.organisationId,
        name: contacts.name,
        jobTitle: contacts.jobTitle,
        email: contacts.email,
        phone: contacts.phone,
        gap: contacts.gap,
      })
      .from(contacts)
      .orderBy(asc(contacts.name)),

    db
      .select({
        id: activities.id,
        organisationId: activities.organisationId,
        kind: activities.kind,
        occurredAt: activities.occurredAt,
        summary: activities.summary,
        actorEmail: people.email,
        contactName: contacts.name,
      })
      .from(activities)
      .leftJoin(people, eq(activities.actorId, people.id))
      .leftJoin(contacts, eq(activities.contactId, contacts.id))
      /* Newest first, which is how the panel shows it. */
      .orderBy(desc(activities.occurredAt), desc(activities.createdAt)),

    db
      .select({
        id: followUps.id,
        organisationId: followUps.organisationId,
        dueAt: followUps.dueAt,
        note: followUps.note,
      })
      .from(followUps)
      .where(eq(followUps.status, "open"))
      /* Soonest first: the chip shows the next thing owed, not the last one set. */
      .orderBy(asc(followUps.dueAt)),
  ]);

  const contactsByOrg = new Map<string, OrgContact[]>();
  for (const c of contactRows) {
    const list = contactsByOrg.get(c.organisationId) ?? [];
    list.push({
      id: c.id,
      name: c.name,
      jobTitle: c.jobTitle,
      email: c.email,
      phone: c.phone,
      gap: c.gap,
    });
    contactsByOrg.set(c.organisationId, list);
  }

  const activitiesByOrg = new Map<string, OrgActivity[]>();
  for (const a of activityRows) {
    if (!a.organisationId) continue;
    const list = activitiesByOrg.get(a.organisationId) ?? [];
    list.push({
      id: a.id,
      kind: a.kind,
      occurredAt: a.occurredAt,
      summary: a.summary,
      actorEmail: a.actorEmail,
      contactName: a.contactName,
    });
    activitiesByOrg.set(a.organisationId, list);
  }

  const followUpByOrg = new Map<string, { id: string; dueAt: string; note: string | null }>();
  for (const f of followUpRows) {
    if (f.organisationId && !followUpByOrg.has(f.organisationId)) {
      followUpByOrg.set(f.organisationId, { id: f.id, dueAt: f.dueAt, note: f.note });
    }
  }

  return orgRows.map((o) => ({
    id: o.id,
    name: o.name,
    sector: o.sector,
    tier: o.tier,
    relationship: o.relationship,
    contactStatus: o.contactStatus,
    referralPotential: o.referralPotential,
    website: o.website,
    location: o.location,
    region: o.region,
    estimatedValuePence: o.estimatedValuePence,
    notes: o.notes,
    contacts: contactsByOrg.get(o.id) ?? [],
    activities: activitiesByOrg.get(o.id) ?? [],
    followUp: followUpByOrg.get(o.id) ?? null,
  }));
}
