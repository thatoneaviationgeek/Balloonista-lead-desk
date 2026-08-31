/**
 * Reads for the Due view — the screen she opens in the morning.
 *
 * Server only. Bucketing happens on `YYYY-MM-DD` strings against today in
 * Europe/London; see `src/lib/dates.ts` for why neither the server's clock nor
 * Postgres `CURRENT_DATE` can be trusted to say what day it is.
 */
import { and, eq, lt, sql } from "drizzle-orm";
import { dueBucket, todayInLondon, type DueBucket } from "./dates";
import { db } from "@/db";
import { contacts, followUps, leads, organisations, people } from "@/db/schema";

export type DueItem = {
  id: string;
  dueAt: string;
  note: string | null;
  bucket: DueBucket;
  /** What it is about, most specific first: contact, then organisation, then lead. */
  subject: string;
  context: string | null;
  leadId: string | null;
  assigneeEmail: string | null;
  mine: boolean;
};

export type DueList = {
  today: string;
  overdue: DueItem[];
  next7: DueItem[];
  later: DueItem[];
  total: number;
};

/** Open follow-ups, oldest first. `scope: "mine"` is the default view. */
export async function listDue(personId: string, scope: "mine" | "all"): Promise<DueList> {
  const today = todayInLondon();

  const rows = await db
    .select({
      id: followUps.id,
      dueAt: followUps.dueAt,
      note: followUps.note,
      assigneeId: followUps.assigneeId,
      assigneeEmail: people.email,
      leadId: followUps.leadId,
      leadTitle: leads.title,
      organisationName: organisations.name,
      contactName: contacts.name,
    })
    .from(followUps)
    .leftJoin(leads, eq(followUps.leadId, leads.id))
    .leftJoin(organisations, eq(followUps.organisationId, organisations.id))
    .leftJoin(contacts, eq(followUps.contactId, contacts.id))
    .leftJoin(people, eq(followUps.assigneeId, people.id))
    .where(
      scope === "mine"
        ? and(eq(followUps.status, "open"), eq(followUps.assigneeId, personId))
        : eq(followUps.status, "open"),
    )
    .orderBy(followUps.dueAt);

  const items: DueItem[] = rows.map((r) => {
    /* Most specific label wins: a person, then the organisation, then the lead
       it came from. Something always survives, because a follow-up cannot exist
       without at least one link. */
    const subject = r.contactName ?? r.organisationName ?? r.leadTitle ?? "Untitled";
    const context =
      r.contactName && r.organisationName
        ? r.organisationName
        : r.organisationName && r.leadTitle
          ? r.leadTitle
          : r.contactName || r.organisationName
            ? r.leadTitle
            : null;

    return {
      id: r.id,
      dueAt: r.dueAt,
      note: r.note,
      bucket: dueBucket(r.dueAt, today),
      subject,
      context,
      leadId: r.leadId,
      assigneeEmail: r.assigneeEmail,
      mine: r.assigneeId === personId,
    };
  });

  return {
    today,
    overdue: items.filter((i) => i.bucket === "overdue"),
    next7: items.filter((i) => i.bucket === "next7"),
    later: items.filter((i) => i.bucket === "later"),
    total: items.length,
  };
}

/**
 * Overdue count for the app bar, so it is visible from the leads page too.
 * Hers, not everyone's — a number that is not about you is noise, and the app
 * bar is the wrong place to negotiate scope.
 */
export async function countOverdueForPerson(personId: string): Promise<number> {
  if (!personId) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(followUps)
    .where(
      and(
        eq(followUps.status, "open"),
        eq(followUps.assigneeId, personId),
        /* Compared against London's today, passed in as a parameter. Postgres
           `CURRENT_DATE` would be a day behind for the first hour after London
           midnight, every night, all summer. */
        lt(followUps.dueAt, todayInLondon()),
      ),
    );
  return row?.n ?? 0;
}
