/**
 * Reads for the jobs board.
 *
 * Server only. Jobs are booked work — an install on a date, at a time, at a
 * venue. Google Calendar stays the source of truth for *when*; this is the
 * operational layer around it, answering the questions a calendar cannot: what
 * is on this week, what is confirmed with nobody assigned, and which enquiry it
 * came from.
 *
 * Until the calendar sync exists, every job here was created by hand — which is
 * a supported way to work, not a placeholder. Some work never touches the
 * calendar.
 */
import { and, asc, count, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { londonDateOf, londonTimeOf } from "./dates";
import { db } from "@/db";
import { jobs, leads, people, tasks } from "@/db/schema";

export type JobStatus =
  | "enquiry"
  | "quoted"
  | "confirmed"
  | "delivered"
  | "invoiced"
  | "cancelled";
export type JobType = "install" | "courier" | "set_dec" | "other";

export const JOB_STATUSES: readonly JobStatus[] = [
  "enquiry",
  "quoted",
  "confirmed",
  "delivered",
  "invoiced",
  "cancelled",
];
export const JOB_TYPES: readonly JobType[] = ["install", "courier", "set_dec", "other"];

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  enquiry: "Enquiry",
  quoted: "Quoted",
  confirmed: "Confirmed",
  delivered: "Delivered",
  invoiced: "Invoiced",
  cancelled: "Cancelled",
};

export const JOB_TYPE_LABEL: Record<JobType, string> = {
  install: "Install",
  courier: "Courier",
  set_dec: "Set dec",
  other: "Other",
};

export type JobView = {
  id: string;
  title: string;
  clientName: string | null;
  venue: string | null;
  type: JobType;
  status: JobStatus;
  region: "UK" | "Dubai";
  /** The London calendar date the job starts on, or null if undated. */
  startsOn: string | null;
  /** London clock time, `HH:mm`. Null for an all-day or undated job. */
  startsAtTime: string | null;
  endsAtTime: string | null;
  valuePence: number | null;
  ownerId: string | null;
  ownerEmail: string | null;
  leadId: string | null;
  leadTitle: string | null;
  notes: string | null;
  taskCount: number;
  openTaskCount: number;
  /**
   * Confirmed, dated, and nobody assigned. The brief calls this "the whole
   * point" — a job somebody has committed to with no one going to it is the one
   * thing a calendar will never tell you.
   */
  unresourced: boolean;
};

/** Everyone who can be given a job. */
export type OwnerOption = { id: string; email: string; name: string | null };

export async function listOwnerOptions(): Promise<OwnerOption[]> {
  return db
    .select({ id: people.id, email: people.email, name: people.name })
    .from(people)
    .where(eq(people.active, true))
    .orderBy(asc(people.email));
}

/**
 * Every job, with its owner, its originating lead and its task counts.
 *
 * Deliberately not paginated or date-filtered in SQL: the week and month views
 * bucket by *London* calendar date, and a `timestamptz` comparison in Postgres
 * would be done in the database's zone, which is UTC. Filtering here on a
 * London date string is the same reasoning as everywhere else in this codebase,
 * and at this volume the whole table is a rounding error.
 */
export async function listJobs(): Promise<JobView[]> {
  const [rows, taskRows] = await Promise.all([
    db
      .select({
        id: jobs.id,
        title: jobs.title,
        clientName: jobs.clientName,
        venue: jobs.venue,
        type: jobs.type,
        status: jobs.status,
        region: jobs.region,
        startsAt: jobs.startsAt,
        endsAt: jobs.endsAt,
        valuePence: jobs.valuePence,
        ownerId: jobs.ownerId,
        ownerEmail: people.email,
        leadId: jobs.leadId,
        leadTitle: leads.title,
        notes: jobs.notes,
      })
      .from(jobs)
      .leftJoin(people, eq(jobs.ownerId, people.id))
      .leftJoin(leads, eq(jobs.leadId, leads.id))
      .orderBy(asc(jobs.startsAt), asc(jobs.title)),

    db
      .select({
        jobId: tasks.jobId,
        total: count(),
        open: sql<number>`count(*) filter (where ${tasks.status} <> 'done')::int`,
      })
      .from(tasks)
      .groupBy(tasks.jobId),
  ]);

  const tasksByJob = new Map(
    taskRows.filter((t) => t.jobId).map((t) => [t.jobId as string, t]),
  );

  return rows.map((r) => {
    const t = tasksByJob.get(r.id);
    return {
      id: r.id,
      title: r.title,
      clientName: r.clientName,
      venue: r.venue,
      type: r.type,
      status: r.status,
      region: r.region,
      startsOn: r.startsAt ? londonDateOf(r.startsAt) : null,
      startsAtTime: r.startsAt ? londonTimeOf(r.startsAt) : null,
      endsAtTime: r.endsAt ? londonTimeOf(r.endsAt) : null,
      valuePence: r.valuePence,
      ownerId: r.ownerId,
      ownerEmail: r.ownerEmail,
      leadId: r.leadId,
      leadTitle: r.leadTitle,
      notes: r.notes,
      taskCount: Number(t?.total ?? 0),
      openTaskCount: Number(t?.open ?? 0),
      unresourced: r.status === "confirmed" && !r.ownerId && !!r.startsAt,
    };
  });
}

/**
 * Confirmed jobs with nobody assigned, for the app bar. Counted in SQL rather
 * than by loading the board, because the app bar renders on every page.
 */
export async function countUnresourced(): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(and(eq(jobs.status, "confirmed"), sql`${jobs.ownerId} is null`));
  return row?.n ?? 0;
}

/** Used by the write paths to check a job exists before changing it. */
export async function jobsInRange(from: Date, to: Date) {
  return db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(gte(jobs.startsAt, from), lte(jobs.startsAt, to)));
}

export async function jobsByIds(ids: string[]) {
  if (!ids.length) return [];
  return db.select().from(jobs).where(inArray(jobs.id, ids)).orderBy(desc(jobs.createdAt));
}
