/**
 * Prove the Phase 2A write paths.
 *
 *   npx tsx src/scripts/check-pipeline.ts
 *
 * Calls the functions in `src/lib/pipeline-writes.ts` directly. The routes are a
 * thin auth-and-parse layer over exactly these, so this covers everything except
 * the session check itself — and it needs no session cookie to do it.
 *
 * The case that matters is logging contact on a lead still marked New: four
 * writes in one batch, all-or-nothing, plus the lead_events row that explains
 * why the lead became Approved.
 *
 * Safe against a database holding real leads. Everything written is tagged with
 * a run id unique to the process, cleanup runs in a `finally` so a failed
 * assertion still tidies up, the deletes refuse to touch anything untagged, and
 * every table's untagged count is compared before and after. The actor is an
 * existing person rather than a fake one — `people` is the login allow-list, and
 * inserting a fictional email there would hand it a way in, however briefly.
 */
import { config as loadEnv } from "dotenv";

/* Next.js reads .env.local automatically; standalone scripts do not. */
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { randomUUID } from "node:crypto";
import { eq, like, sql } from "drizzle-orm";
import { addDays, todayInLondon } from "../lib/dates";
import {
  changeOrganisationStage,
  createFollowUp,
  logActivity,
  recordFeedback,
  setLeadStatus,
  updateFollowUp,
  type Writer,
  type WriteResult,
} from "../lib/pipeline-writes";
import { buildDigest } from "../lib/digest";
import { countOverdueForPerson, listDue } from "../lib/due";
import { db } from "../db";
import {
  activities,
  contacts,
  followUps,
  leadFeedback,
  leadEvents,
  leads,
  organisationEvents,
  organisations,
  people,
} from "../db/schema";

const TAG = `test-pipeline-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
const TODAY = todayInLondon();

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${detail ? `  — ${detail}` : ""}`);
}

function refused(result: WriteResult<unknown>, status: number, code?: string) {
  if (result.ok) return false;
  return result.status === status && (code === undefined || result.code === code);
}

const TABLES = {
  leads,
  people,
  organisations,
  contacts,
  activities,
  follow_ups: followUps,
  lead_feedback: leadFeedback,
  lead_events: leadEvents,
  organisation_events: organisationEvents,
} as const;

async function counts() {
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries(TABLES)) {
    const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(table);
    out[name] = row.n;
  }
  return out;
}

async function main() {
  console.log(`tag   : ${TAG}`);
  console.log(`today : ${TODAY} (Europe/London)\n`);

  const before = await counts();
  console.log("Rows before:", JSON.stringify(before), "\n");

  const [actor] = await db.select().from(people).limit(1);
  if (!actor) {
    console.error("No people rows — run `npm run people:add` first.");
    process.exit(1);
  }
  const writer: Writer = { personId: actor.id, email: actor.email };

  /* A synthetic lead. AGENTS.md forbids inventing lead data anywhere, fixtures
     included, so this names no company, person or address and uses the same
     `GAP — …` form the scanners write when they could not verify a contact. */
  const leadId = randomUUID();
  await db.insert(leads).values({
    id: leadId,
    region: "UK",
    dedupeKey: `${TAG}-lead`,
    agent: "Events",
    title: `TEST ROW — pipeline harness ${TAG} (safe to delete)`,
    what: "Synthetic row written by check-pipeline.ts.",
    contact: "GAP — synthetic test row, not a real contact",
  });

  try {
    /* 1 ------------------------------------- a New lead demands confirmation */
    console.log("1. Logging contact on a New lead requires explicit approval");
    const refusal = await logActivity(writer, {
      kind: "email_sent",
      occurredAt: TODAY,
      summary: "Test — should be refused",
      leadId,
      newOrganisation: { name: `TEST ORG ${TAG}` },
    });
    check("refused with 409 lead_approval_required", refused(refusal, 409, "lead_approval_required"));

    const afterRefusal = await counts();
    check("nothing was written", afterRefusal.activities === before.activities &&
      afterRefusal.organisations === before.organisations,
      `activities ${afterRefusal.activities}, organisations ${afterRefusal.organisations}`);
    const [stillNew] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    check("the lead is still New", stillNew.status === "New", `got ${stillNew.status}`);

    /* 2 ---------------------------- four writes, one batch, all-or-nothing */
    console.log("\n2. Confirmed: organisation, contact, activity and approval in one batch");
    const logged = await logActivity(writer, {
      kind: "email_sent",
      occurredAt: "2026-08-28",
      summary: "Emailed about the gala",
      leadId,
      approveLead: true,
      newOrganisation: { name: `TEST ORG ${TAG}` },
      newContact: { name: `TEST CONTACT ${TAG}`, email: `${TAG}@example.invalid`, jobTitle: "Tester" },
    });
    check("accepted", logged.ok, logged.ok ? "" : logged.error);
    if (!logged.ok) throw new Error("cannot continue");
    const { organisationId, contactId } = logged.data;
    check("reports the lead as approved", logged.data.leadApproved === true);
    check("an organisation was created", !!organisationId);
    check("a contact was created", !!contactId);

    const [lead2] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    check("the lead is now Approved", lead2.status === "Approved", `got ${lead2.status}`);
    check("statusChangedBy records who", lead2.statusChangedBy === actor.id);

    const events = await db.select().from(leadEvents).where(eq(leadEvents.leadId, leadId));
    check("exactly one lead_events row", events.length === 1, `found ${events.length}`);
    check("it explains the approval",
      (events[0]?.note ?? "").includes("logged"), events[0]?.note ?? "(none)");
    check("from New to Approved",
      events[0]?.fromStatus === "New" && events[0]?.toStatus === "Approved");

    const acts = await db.select().from(activities).where(eq(activities.leadId, leadId));
    check("exactly one activity", acts.length === 1, `found ${acts.length}`);
    check("occurredAt survived as a date string", acts[0]?.occurredAt === "2026-08-28",
      String(acts[0]?.occurredAt));
    check("the activity carries the organisation as well as the contact",
      acts[0]?.organisationId === organisationId && acts[0]?.contactId === contactId);

    /* 3 ------------------------------------------- dedupe keys do their job */
    console.log("\n3. Logging again against the same names reuses them");
    const again = await logActivity(writer, {
      kind: "call",
      occurredAt: TODAY,
      summary: "Rang to chase",
      leadId,
      newOrganisation: { name: `TEST ORG ${TAG}` },
      newContact: { name: `TEST CONTACT ${TAG}`, email: `${TAG}@example.invalid` },
    });
    check("accepted", again.ok, again.ok ? "" : again.error);
    if (again.ok) {
      check("same organisation", again.data.organisationId === organisationId);
      check("same contact", again.data.contactId === contactId);
    }
    const orgCount = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(organisations)
      .where(like(organisations.dedupeKey, "%" + TAG.toLowerCase() + "%"));
    check("still exactly one test organisation", orgCount[0].n === 1, `found ${orgCount[0].n}`);

    /* 4 ----------------------------------------------------- refusals */
    console.log("\n4. Bad input is refused with a sentence, not a constraint error");
    check("a future occurredAt", refused(
      await logActivity(writer, { kind: "note", occurredAt: addDays(TODAY, 1), summary: "x", leadId }), 400));
    check("an unknown kind", refused(
      await logActivity(writer, { kind: "smoke_signal", occurredAt: TODAY, summary: "x", leadId }), 400));
    check("a date that is not one", refused(
      await logActivity(writer, { kind: "note", occurredAt: "2026-02-30", summary: "x", leadId }), 400));
    check("no summary", refused(
      await logActivity(writer, { kind: "note", occurredAt: TODAY, summary: "  ", leadId }), 400));
    check("no link at all", refused(
      await logActivity(writer, { kind: "note", occurredAt: TODAY, summary: "x" }), 400));
    const prose = await logActivity(writer, {
      kind: "note", occurredAt: TODAY, summary: "x", organisationId,
      newContact: { name: "TEST", email: "Find her on LinkedIn" },
    });
    check("prose in the email field", refused(prose, 400));
    check("and the message points at `gap`",
      !prose.ok && prose.error.includes("gap"), prose.ok ? "" : prose.error);

    /* 5 ------------------------------------------------------- follow-ups */
    console.log("\n5. Follow-ups");
    const created = await createFollowUp(writer, {
      dueAt: addDays(TODAY, 7), note: "Chase if no reply", contactId,
    });
    check("created", created.ok, created.ok ? "" : created.error);
    if (!created.ok) throw new Error("cannot continue");
    const [fu] = await db.select().from(followUps).where(eq(followUps.id, created.data.id)).limit(1);
    check("assigned to the writer by default", fu.assigneeId === actor.id);
    check("open", fu.status === "open");
    check("carries the organisation alongside the contact",
      fu.organisationId === organisationId, String(fu.organisationId));
    check("dueAt is a date string", fu.dueAt === addDays(TODAY, 7), String(fu.dueAt));

    /* 6 -------------------------------- completing offers the next in one step */
    console.log("\n6. Completing one sets the next, in the same step");
    const done = await updateFollowUp(writer, created.data.id, {
      status: "done",
      next: { dueAt: addDays(TODAY, 14), note: "Second chase" },
    });
    check("accepted", done.ok, done.ok ? "" : done.error);
    if (!done.ok) throw new Error("cannot continue");
    check("a replacement was created", !!done.data.nextId);

    const [completed] = await db.select().from(followUps).where(eq(followUps.id, created.data.id)).limit(1);
    check("the original is done", completed.status === "done");
    check("and has a completedAt", completed.completedAt !== null);
    check("but still exists — history is not deleted", !!completed.id);

    const [next] = await db.select().from(followUps).where(eq(followUps.id, done.data.nextId!)).limit(1);
    check("the replacement is open", next.status === "open");
    check("due two weeks out", next.dueAt === addDays(TODAY, 14), String(next.dueAt));
    check("and inherited the links", next.contactId === contactId && next.organisationId === organisationId);

    check("cancelling does not set completedAt", await (async () => {
      const c = await createFollowUp(writer, { dueAt: TODAY, contactId });
      if (!c.ok) return false;
      await updateFollowUp(writer, c.data.id, { status: "cancelled" });
      const [row] = await db.select().from(followUps).where(eq(followUps.id, c.data.id)).limit(1);
      return row.status === "cancelled" && row.completedAt === null;
    })());

    /* 7 --------------------------------------------------------- feedback */
    console.log("\n7. Lead feedback");
    check("not useful without a reason is refused",
      refused(await recordFeedback(writer, leadId, { verdict: "not_useful" }), 400));
    const fb1 = await recordFeedback(writer, leadId, {
      verdict: "not_useful", reason: "wrong_sector", note: "Test note",
    });
    check("not useful with a reason is accepted", fb1.ok, fb1.ok ? "" : fb1.error);
    const fb2 = await recordFeedback(writer, leadId, { verdict: "useful" });
    check("changing her mind is accepted", fb2.ok, fb2.ok ? "" : fb2.error);
    check("it is the same row, not a second one",
      fb1.ok && fb2.ok && fb1.data.id === fb2.data.id);
    const rows = await db.select().from(leadFeedback).where(eq(leadFeedback.leadId, leadId));
    check("exactly one feedback row for this lead and person", rows.length === 1, `found ${rows.length}`);
    check("the stale reason was cleared", rows[0]?.reason === null, String(rows[0]?.reason));
    check("useful is never asked to justify itself", rows[0]?.verdict === "useful");

    /* 8 -------------------------------- the assumption the design rests on */
    console.log("\n8. db.batch really is atomic");
    const probeKey = `${TAG}-atomic`;
    let threw = false;
    try {
      await db.batch([
        db.insert(organisations).values({
          id: randomUUID(), region: "UK", dedupeKey: probeKey, name: `TEST ATOMIC ${TAG}`,
        }),
        /* References a contact that does not exist: the FK rejects it. */
        db.insert(activities).values({
          id: randomUUID(), kind: "note", occurredAt: TODAY, summary: "should never land",
          contactId: randomUUID(), organisationId: randomUUID(),
        }),
      ]);
    } catch {
      threw = true;
    }
    check("the batch was rejected", threw);
    const probe = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(organisations)
      .where(eq(organisations.dedupeKey, probeKey));
    check("and the first write rolled back with it", probe[0].n === 0, `found ${probe[0].n}`);

    /* 9 ------------------------------------------------- the Due view reads */
    console.log("\n9. Due buckets, against real rows");
    const mk = async (days: number) => {
      const r = await createFollowUp(writer, { dueAt: addDays(TODAY, days), contactId });
      if (!r.ok) throw new Error(r.error);
      return r.data.id;
    };
    const lateId = await mk(-1);
    const soonId = await mk(3);
    const edgeId = await mk(7);
    const laterId = await mk(8);

    const list = await listDue(actor.id, "mine");
    check("today is London's today", list.today === TODAY, list.today);
    check("yesterday is overdue", list.overdue.some((i) => i.id === lateId));
    check("in 3 days is in the next 7", list.next7.some((i) => i.id === soonId));
    check("day 7 is the last one inside", list.next7.some((i) => i.id === edgeId));
    check("day 8 has tipped into later", list.later.some((i) => i.id === laterId));
    check("the subject falls back to the contact name",
      list.overdue.find((i) => i.id === lateId)?.subject?.includes("TEST CONTACT") === true,
      list.overdue.find((i) => i.id === lateId)?.subject);
    check("completed follow-ups are not listed",
      !list.overdue.concat(list.next7, list.later).some((i) => i.id === created.data.id));

    const overdueCount = await countOverdueForPerson(actor.id);
    check("the app bar count matches the overdue bucket",
      overdueCount === list.overdue.length, `count ${overdueCount}, bucket ${list.overdue.length}`);

    const everyone = await listDue(actor.id, "all");
    check("scope all is a superset of mine", everyone.total >= list.total,
      `all ${everyone.total}, mine ${list.total}`);

    /* 10 ------------------------------------ the digest, and what it may not say */
    console.log("\n10. Feedback digest");
    await recordFeedback(writer, leadId, {
      verdict: "not_useful", reason: "wrong_sector", note: "Test note for the digest",
    });
    const digest = await buildDigest({ agent: null, region: null, since: null });
    check("counts the rejection", digest.totals.notUseful >= 1, String(digest.totals.notUseful));
    check("groups it by reason",
      digest.byReason.some((r) => r.reason === "wrong_sector"), JSON.stringify(digest.byReason));
    check("breaks down by scanner", digest.byAgent.some((a) => a.agent === "Events"));
    check("includes it as an example",
      digest.examples.notUseful.some((e) => e.title.includes(TAG)));
    check("renders a pasteable block",
      digest.promptText.includes("Why leads were rejected"), digest.promptText.slice(0, 60));

    /* Boundary one: personal data must not leave at all. The read key is held
       by scheduled tasks, and third-party contact details have no business
       anywhere in this response. */
    const serialised = JSON.stringify(digest);
    check("no contact email anywhere in the digest",
      !serialised.includes("@example.invalid"));
    check("no contact name anywhere in the digest",
      !serialised.includes("TEST CONTACT"));
    check("no lead contact field either",
      !serialised.includes("GAP — synthetic test row"));

    /* Boundary two, and a different one: untrusted text must not reach
       promptText, because that block is pasted into the prompt of an agent
       holding a POST credential. Lead titles are harvested off web pages. */
    check("the lead title is absent from promptText",
      !digest.promptText.includes(TAG), digest.promptText.slice(0, 80));
    check("but is present in the structured examples, for a person to read",
      JSON.stringify(digest.examples).includes(TAG));
    check("the response declares which fields are untrusted",
      digest.untrusted.includes("examples[].title"), JSON.stringify(digest.untrusted));
    check("her own note does reach promptText — she is trusted",
      digest.promptText.includes("Test note for the digest"));

    /* 11 -------------------------------------------- moving a pipeline stage */
    console.log("\n11. Organisation stage changes");
    const [orgBefore] = await db
      .select().from(organisations).where(eq(organisations.id, organisationId!)).limit(1);
    check("starts at not_contacted", orgBefore.contactStatus === "not_contacted",
      orgBefore.contactStatus);

    const moved = await changeOrganisationStage(writer, organisationId!, {
      stage: "initial_email_sent",
    });
    check("accepted", moved.ok, moved.ok ? "" : moved.error);
    if (!moved.ok) throw new Error("cannot continue");
    check("reports the move", moved.data.from === "not_contacted" &&
      moved.data.to === "initial_email_sent" && !moved.data.unchanged);

    const [orgAfter] = await db
      .select().from(organisations).where(eq(organisations.id, organisationId!)).limit(1);
    check("the stage actually moved", orgAfter.contactStatus === "initial_email_sent",
      orgAfter.contactStatus);

    const evs = await db.select().from(organisationEvents)
      .where(eq(organisationEvents.organisationId, organisationId!));
    check("one audit row", evs.length === 1, `found ${evs.length}`);
    check("it records from, to and who",
      evs[0]?.fromStage === "not_contacted" && evs[0]?.toStage === "initial_email_sent" &&
        evs[0]?.actorId === actor.id && evs[0]?.action === "stage");

    /* Moving with a `next` puts the stage change and the reminder in one batch. */
    const fuBefore = (await db.select().from(followUps)
      .where(eq(followUps.organisationId, organisationId!))).length;
    const withNext = await changeOrganisationStage(writer, organisationId!, {
      stage: "have_a_contact",
      next: { dueAt: addDays(TODAY, 14) },
    });
    check("move with a follow-up accepted", withNext.ok, withNext.ok ? "" : withNext.error);
    check("a follow-up came with it", withNext.ok && !!withNext.data.followUpId);
    const fuAfter = await db.select().from(followUps)
      .where(eq(followUps.organisationId, organisationId!));
    check("exactly one more follow-up", fuAfter.length === fuBefore + 1,
      `${fuBefore} -> ${fuAfter.length}`);
    check("two audit rows now", (await db.select().from(organisationEvents)
      .where(eq(organisationEvents.organisationId, organisationId!))).length === 2);

    /* Re-picking the stage it is already in is a no-op, not a spurious row. */
    const same = await changeOrganisationStage(writer, organisationId!, { stage: "have_a_contact" });
    check("same stage reports unchanged", same.ok && same.data.unchanged === true);
    check("and wrote no audit row", (await db.select().from(organisationEvents)
      .where(eq(organisationEvents.organisationId, organisationId!))).length === 2);

    check("an unknown stage is refused",
      refused(await changeOrganisationStage(writer, organisationId!, { stage: "won" }), 400));
    check("an unknown organisation is refused",
      refused(await changeOrganisationStage(writer, randomUUID(), { stage: "not_contacted" }), 404));

    /* 12 ------------------------------- approving a lead onto an account */
    console.log("\n12. Approving a lead attaches it to an organisation");

    /* A second synthetic lead: the first was approved back in step 2. */
    const leadB = randomUUID();
    await db.insert(leads).values({
      id: leadB,
      region: "UK",
      dedupeKey: `${TAG}-lead-b`,
      agent: "Hotels",
      title: `TEST ROW — approve harness ${TAG} (safe to delete)`,
      entity: `TEST ENTITY ${TAG}`,
      what: "Synthetic row written by check-pipeline.ts.",
      contact: "GAP — synthetic test row, not a real contact",
    });

    const attached = await setLeadStatus(writer, leadB, {
      status: "Approved",
      organisationId,
    });
    check("approved and attached", attached.ok, attached.ok ? "" : attached.error);
    if (!attached.ok) throw new Error("cannot continue");
    check("reports the transition", attached.data.from === "New" && attached.data.to === "Approved");
    check("reports the account", attached.data.organisationId === organisationId);
    check("did not create one", attached.data.organisationCreated === false);

    const [leadBRow] = await db.select().from(leads).where(eq(leads.id, leadB)).limit(1);
    check("the lead is Approved", leadBRow.status === "Approved", leadBRow.status);
    check("organisationId is set", leadBRow.organisationId === organisationId);
    check("statusChangedBy records who", leadBRow.statusChangedBy === actor.id);

    const bEvents = await db.select().from(leadEvents).where(eq(leadEvents.leadId, leadB));
    check("one lead_events row", bEvents.length === 1, `found ${bEvents.length}`);
    check("New to Approved", bEvents[0]?.fromStatus === "New" && bEvents[0]?.toStatus === "Approved");

    const orgNotes = (await db.select().from(organisationEvents)
      .where(eq(organisationEvents.organisationId, organisationId!)))
      .filter((e) => e.action === "note");
    check("the account records where it was linked from",
      orgNotes.some((e) => (e.note ?? "").includes("approve harness")),
      orgNotes.map((e) => e.note).join(" | "));

    /* Creating an account from the lead, then the same name again. */
    const leadC = randomUUID();
    await db.insert(leads).values({
      id: leadC, region: "UK", dedupeKey: `${TAG}-lead-c`, agent: "Hotels",
      title: `TEST ROW — new account ${TAG} (safe to delete)`,
      what: "Synthetic row.", contact: "GAP — synthetic test row, not a real contact",
    });
    const madeAccount = await setLeadStatus(writer, leadC, {
      status: "Approved",
      newOrganisation: { name: `TEST NEW ACCOUNT ${TAG}` },
    });
    check("creating an account works", madeAccount.ok, madeAccount.ok ? "" : madeAccount.error);
    check("and says it created one", madeAccount.ok && madeAccount.data.organisationCreated === true);

    const leadD = randomUUID();
    await db.insert(leads).values({
      id: leadD, region: "UK", dedupeKey: `${TAG}-lead-d`, agent: "Hotels",
      title: `TEST ROW — dupe account ${TAG} (safe to delete)`,
      what: "Synthetic row.", contact: "GAP — synthetic test row, not a real contact",
    });
    const reusedAccount = await setLeadStatus(writer, leadD, {
      status: "Approved",
      newOrganisation: { name: `TEST NEW ACCOUNT ${TAG}` },
    });
    check("the same name reuses rather than duplicating",
      reusedAccount.ok && reusedAccount.data.organisationCreated === false &&
        madeAccount.ok && reusedAccount.data.organisationId === madeAccount.data.organisationId);

    /* Approving without linking is allowed — she may not know the account yet. */
    const leadE = randomUUID();
    await db.insert(leads).values({
      id: leadE, region: "UK", dedupeKey: `${TAG}-lead-e`, agent: "Hotels",
      title: `TEST ROW — unlinked ${TAG} (safe to delete)`,
      what: "Synthetic row.", contact: "GAP — synthetic test row, not a real contact",
    });
    const bare = await setLeadStatus(writer, leadE, { status: "Approved" });
    check("approving without an account works", bare.ok);
    const [leadERow] = await db.select().from(leads).where(eq(leads.id, leadE)).limit(1);
    check("status moved but no account attached",
      leadERow.status === "Approved" && leadERow.organisationId === null);

    check("re-approving is a no-op",
      (await setLeadStatus(writer, leadE, { status: "Approved" })).ok &&
        (await db.select().from(leadEvents).where(eq(leadEvents.leadId, leadE))).length === 1);
    check("an unknown status is refused",
      refused(await setLeadStatus(writer, leadE, { status: "Maybe" }), 400));
    check("an unknown account is refused",
      refused(await setLeadStatus(writer, leadE, { status: "Approved", organisationId: randomUUID() }), 404));
  } finally {
    /* 11 --------------------------------------------------------- tidy up */
    console.log("\n12. Cleaning up");
    const taggedLeads = await db.select({ id: leads.id, k: leads.dedupeKey }).from(leads)
      .where(like(leads.dedupeKey, `${TAG}%`));
    const taggedOrgs = await db.select({ id: organisations.id, k: organisations.dedupeKey })
      .from(organisations).where(like(organisations.dedupeKey, `%${TAG.toLowerCase()}%`));
    if (taggedLeads.some((r) => !r.k.startsWith(TAG))) throw new Error("refusing to delete untagged leads");
    if (taggedOrgs.some((r) => !r.k.includes(TAG.toLowerCase()))) throw new Error("refusing to delete untagged organisations");

    if (taggedLeads.length) await db.delete(leads).where(like(leads.dedupeKey, `${TAG}%`));
    if (taggedOrgs.length) {
      await db.delete(organisations).where(like(organisations.dedupeKey, `%${TAG.toLowerCase()}%`));
    }
    console.log(`  removed ${taggedLeads.length} lead(s) and ${taggedOrgs.length} organisation(s), cascades included`);

    const after = await counts();
    const before2 = before;
    let clean = true;
    for (const key of Object.keys(before2)) {
      if (after[key] !== before2[key]) {
        clean = false;
        console.log(`  FAIL ${key}: ${after[key]}, expected ${before2[key]}`);
      }
    }
    check("every table is back to its starting count", clean, JSON.stringify(after));
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("\n" + (error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exit(1);
});
