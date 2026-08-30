import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { badRequest, optionalText, readJson, requireWriter } from "@/lib/api-auth";
import { isIsoDate, todayInLondon } from "@/lib/dates";
import {
  ACTIVITY_KINDS,
  contactDedupeKey,
  looksLikeEmail,
  organisationDedupeKey,
  type ActivityKind,
} from "@/lib/pipeline";
import { db } from "@/db";
import { activities, contacts, leadEvents, leads, organisations } from "@/db/schema";

/* Record that a person made contact. Nothing here sends anything to anyone —
   AGENTS.md stands. Aurelija emails whomever she likes from her own inbox; this
   writes down that she did.

   The neon-http driver has no interactive transactions (`db.transaction()`
   throws), so every route in this slice follows the same shape: read what is
   needed first, mint any new ids with randomUUID(), then commit every write in
   one `db.batch()`, which Neon runs as a single atomic transaction. Nothing is
   read back mid-batch, which is the one thing batch cannot do. */

type Write = Parameters<typeof db.batch>[0][number];

export async function POST(request: Request) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;
  const { writer } = gate;

  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  /* ------------------------------------------------------------ the facts */
  const kind = body.kind;
  if (typeof kind !== "string" || !(ACTIVITY_KINDS as readonly string[]).includes(kind)) {
    return badRequest(`kind must be one of: ${ACTIVITY_KINDS.join(", ")}`);
  }

  const occurredAt = body.occurredAt;
  if (!isIsoDate(occurredAt)) {
    return badRequest("occurredAt must be a calendar date as YYYY-MM-DD");
  }
  /* Today in London, not the server's today — see src/lib/dates.ts. */
  if (occurredAt > todayInLondon()) {
    return badRequest("occurredAt cannot be in the future; this records what has happened");
  }

  const summary = optionalText(body.summary);
  if (!summary) return badRequest("summary is required — one line on what happened");

  const now = new Date();
  const writes: Write[] = [];

  /* ----------------------------------------------- resolve the organisation */
  let organisationId = optionalText(body.organisationId);
  const newOrganisation = asRecord(body.newOrganisation);

  if (!organisationId && newOrganisation) {
    const name = optionalText(newOrganisation.name);
    if (!name) return badRequest("newOrganisation.name is required");
    const region = newOrganisation.region === "Dubai" ? "Dubai" : "UK";
    const dedupeKey = organisationDedupeKey(name);

    /* Match what is already there rather than creating a second Harrods. There
       is a narrow race if two people do this at once; the unique index turns the
       loser into a clean 409 rather than a duplicate. */
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
      writes.push(
        db.insert(organisations).values({ id: organisationId, region, dedupeKey, name }),
      );
    }
  }

  if (organisationId && !newOrganisation) {
    const found = (
      await db
        .select({ id: organisations.id })
        .from(organisations)
        .where(eq(organisations.id, organisationId))
        .limit(1)
    )[0];
    if (!found) return NextResponse.json({ error: "No such organisation" }, { status: 404 });
  }

  /* ---------------------------------------------------- resolve the contact */
  let contactId = optionalText(body.contactId);
  const newContact = asRecord(body.newContact);

  if (contactId) {
    const found = (
      await db
        .select({ id: contacts.id, organisationId: contacts.organisationId })
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1)
    )[0];
    if (!found) return NextResponse.json({ error: "No such contact" }, { status: 404 });
    /* The contact's own organisation wins. Denormalising it onto the activity is
       deliberate: it records where they worked at the time, not where they work
       now. See the comment on activities.organisationId. */
    organisationId = found.organisationId;
  } else if (newContact) {
    if (!organisationId) {
      return badRequest("A new contact needs an organisation: pass organisationId or newOrganisation");
    }
    const name = optionalText(newContact.name);
    const email = optionalText(newContact.email);
    if (!name && !email) return badRequest("newContact needs at least a name or an email");
    if (email && !looksLikeEmail(email)) {
      return badRequest(
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
          jobTitle: optionalText(newContact.jobTitle),
          email,
          phone: optionalText(newContact.phone),
          gap: optionalText(newContact.gap),
        }),
      );
    }
  }

  /* ------------------------------------------------------- resolve the lead */
  const leadId = optionalText(body.leadId);
  let approving = false;

  if (leadId) {
    const lead = (
      await db
        .select({ id: leads.id, status: leads.status })
        .from(leads)
        .where(eq(leads.id, leadId))
        .limit(1)
    )[0];
    if (!lead) return NextResponse.json({ error: "No such lead" }, { status: 404 });

    if (lead.status === "New") {
      /* Logging contact on a lead nobody has triaged would leave it "awaiting
         review" with an email already sent against it. Approving is the honest
         resolution, but it is her decision and it must be explicit — so the
         caller has to say so, and the UI turns this into a confirmation rather
         than moving her lead behind her back. */
      if (body.approveLead !== true) {
        return NextResponse.json(
          {
            error: "This lead is still New. Logging contact will mark it Approved.",
            code: "lead_approval_required",
          },
          { status: 409 },
        );
      }
      approving = true;
    }
  }

  /* ------------------------------------------------------- at least one link */
  if (!leadId && !organisationId && !contactId) {
    return badRequest("An activity must be attached to a lead, an organisation or a contact");
  }

  /* ------------------------------------------------------------ commit once */
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

  return NextResponse.json({
    ok: true,
    activityId,
    organisationId,
    contactId,
    leadApproved: approving,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
