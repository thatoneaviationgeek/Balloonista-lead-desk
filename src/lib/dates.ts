/**
 * Days, not instants.
 *
 * `activities.occurredAt` and `follow_ups.dueAt` are `date` columns: "I emailed
 * Emma on 28 August" and "follow up on 4 September" have no time of day. Storing
 * them as timestamps invites an off-by-one every time they cross BST.
 *
 * Choosing `date` does not remove the timezone problem, it moves it here. Two
 * rules make this module safe, and breaking either reintroduces the bug:
 *
 *  1. A date is a `YYYY-MM-DD` string and never becomes a JS `Date` on the way
 *     to or from the database. `new Date(2026, 8, 4).toISOString().slice(0, 10)`
 *     on a BST server yields "2026-09-03", because local midnight is 23:00 UTC
 *     the day before. Every `Date` constructed in here is built and read in UTC
 *     only, so the host's zone never enters.
 *  2. "Today" is computed in Europe/London explicitly. Vercel runs UTC and so
 *     does Neon, so both `new Date()` and Postgres `CURRENT_DATE` are a day
 *     behind for the first hour after London midnight, every night, all summer.
 */

export const LONDON = "Europe/London";

/* en-CA formats as YYYY-MM-DD, which is what we want and what ISO wants. */
const londonDay = new Intl.DateTimeFormat("en-CA", {
  timeZone: LONDON,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Today where Aurelija is, as `YYYY-MM-DD`. Never the server's idea of today. */
export function todayInLondon(now: Date = new Date()): string {
  return londonDay.format(now);
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a real calendar day in `YYYY-MM-DD`. Rejects 2026-02-30 and friends:
 * the shape test alone would pass them, and Postgres would then reject the
 * insert with a less helpful message than we can give here.
 */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y && probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d
  );
}

/**
 * Shift a `YYYY-MM-DD` by whole days. Built and read entirely in UTC, so it is
 * unaffected by the host's zone and by the BST changeover — adding 1 to
 * "2026-10-24" gives "2026-10-25" even though that particular local day is 25
 * hours long.
 */
export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(shifted.getUTCDate()).padStart(2, "0");
  return `${shifted.getUTCFullYear()}-${mm}-${dd}`;
}

/**
 * Which bucket a due date falls in, relative to today.
 *
 * Overdue / next 7 days / later, with the seven days rolling from today rather
 * than running to the end of a calendar week. A calendar week collapses on a
 * Friday: she would open the Due view to almost nothing while the real workload
 * sat three days out.
 *
 * ISO date strings compare lexicographically in date order, so this is plain
 * string comparison with no `Date` involved anywhere.
 */
export type DueBucket = "overdue" | "next7" | "later";

export function dueBucket(dueAt: string, today: string = todayInLondon()): DueBucket {
  if (dueAt < today) return "overdue";
  return dueAt <= addDays(today, 7) ? "next7" : "later";
}
