/**
 * Reads for the organisations screen — the relationships she works over months
 * and years, as distinct from the one-off moments the scanners find.
 *
 * Server only. Four queries for the whole page rather than one per row.
 */
import { asc, desc, eq, isNotNull } from "drizzle-orm";
import type { ActivityKind } from "./pipeline";
import { db } from "@/db";
import { activities, contacts, followUps, leads, organisations, people } from "@/db/schema";

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

/** A scanner lead that was attached to this account when it was approved. */
export type OrgLead = {
  id: string;
  title: string;
  status: "New" | "Approved" | "Rejected";
  agent: string;
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
  leads: OrgLead[];
};

export async function listOrganisations(): Promise<OrganisationView[]> {
  const [orgRows, contactRows, activityRows, followUpRows, leadRows] = await Promise.all([
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

    /* The other half of the link she asked for: which scanner leads came in
       through this account. Only attached ones — organisationId is null until
       somebody approves a lead and says which account it belongs to. */
    db
      .select({
        id: leads.id,
        organisationId: leads.organisationId,
        title: leads.title,
        status: leads.status,
        agent: leads.agent,
      })
      .from(leads)
      .where(isNotNull(leads.organisationId))
      .orderBy(desc(leads.lastSeenAt)),
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

  const leadsByOrg = new Map<string, OrgLead[]>();
  for (const l of leadRows) {
    if (!l.organisationId) continue;
    const list = leadsByOrg.get(l.organisationId) ?? [];
    list.push({ id: l.id, title: l.title, status: l.status, agent: l.agent });
    leadsByOrg.set(l.organisationId, list);
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
    leads: leadsByOrg.get(o.id) ?? [],
  }));
}

/** Just enough of each organisation to pick one when approving a lead. */
export type OrganisationOption = {
  id: string;
  name: string;
  sector: string | null;
  region: "UK" | "Dubai";
};

/**
 * The whole list, for the approve-a-lead picker. Fifty-seven rows of three
 * columns is small enough to send to the browser and filter there, which keeps
 * the picker instant and avoids a search endpoint that would need its own
 * authorisation.
 */
export async function listOrganisationOptions(): Promise<OrganisationOption[]> {
  return db
    .select({
      id: organisations.id,
      name: organisations.name,
      sector: organisations.sector,
      region: organisations.region,
    })
    .from(organisations)
    .orderBy(asc(organisations.name));
}
