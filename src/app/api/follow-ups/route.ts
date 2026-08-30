import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { badRequest, optionalText, readJson, requireWriter } from "@/lib/api-auth";
import { isIsoDate } from "@/lib/dates";
import { db } from "@/db";
import { contacts, followUps, leads, organisations, people } from "@/db/schema";

/* Set a reminder to come back to something. In-panel only: nothing here emails
   anyone, including staff. If a morning digest is ever added, AGENTS.md gets
   amended first — staff only, never a prospect, written down before it is
   built. */

export async function POST(request: Request) {
  const gate = await requireWriter();
  if (!gate.ok) return gate.response;
  const { writer } = gate;

  const body = await readJson(request);
  if (!body) return badRequest("Body must be a JSON object");

  const dueAt = body.dueAt;
  if (!isIsoDate(dueAt)) {
    return badRequest("dueAt must be a calendar date as YYYY-MM-DD");
  }
  /* A due date in the past is allowed on purpose: overdue is a real state, and
     she may well be recording something she already meant to chase. */

  const leadId = optionalText(body.leadId);
  let organisationId = optionalText(body.organisationId);
  const contactId = optionalText(body.contactId);

  if (leadId) {
    const found = (await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).limit(1))[0];
    if (!found) return NextResponse.json({ error: "No such lead" }, { status: 404 });
  }

  if (contactId) {
    const found = (
      await db
        .select({ id: contacts.id, organisationId: contacts.organisationId })
        .from(contacts)
        .where(eq(contacts.id, contactId))
        .limit(1)
    )[0];
    if (!found) return NextResponse.json({ error: "No such contact" }, { status: 404 });
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
    if (!found) return NextResponse.json({ error: "No such organisation" }, { status: 404 });
  }

  if (!leadId && !organisationId && !contactId) {
    return badRequest("A follow-up must be attached to a lead, an organisation or a contact");
  }

  /* Hers unless she says otherwise — the Due view defaults to the signed-in
     person, so an unassigned follow-up would vanish from the screen she opens. */
  let assigneeId: string | null = optionalText(body.assigneeId) ?? writer.personId ?? null;
  if (assigneeId) {
    const found = (
      await db.select({ id: people.id }).from(people).where(eq(people.id, assigneeId)).limit(1)
    )[0];
    if (!found) return NextResponse.json({ error: "No such person" }, { status: 404 });
  } else {
    assigneeId = null;
  }

  const [row] = await db
    .insert(followUps)
    .values({
      dueAt,
      note: optionalText(body.note),
      assigneeId,
      leadId,
      organisationId,
      contactId,
    })
    .returning();

  return NextResponse.json({ ok: true, followUp: row });
}
