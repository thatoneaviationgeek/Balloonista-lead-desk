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

/**
 * The London calendar date an instant falls on, as `YYYY-MM-DD`.
 *
 * Follow-ups store a day and never have this problem. A job stores an *instant*
 * — "the install is at 09:00 on the 13th" — so working out which day, and
 * therefore which week, it belongs to has to be done in London. An install at
 * 00:30 BST is 23:30 UTC the day before, and would otherwise show up in the
 * wrong week for the half-hour that matters most to whoever is driving to it.
 */
export function londonDateOf(instant: Date): string {
  return londonDay.format(instant);
}

/** Today where Aurelija is, as `YYYY-MM-DD`. Never the server's idea of today. */
export function todayInLondon(now: Date = new Date()): string {
  return londonDay.format(now);
}

/** The time of day in London, `HH:mm`, for an instant. */
const londonClock = new Intl.DateTimeFormat("en-GB", {
  timeZone: LONDON,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export function londonTimeOf(instant: Date): string {
  return londonClock.format(instant);
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

/**
 * The Monday of the week a date falls in, and the Sunday that ends it.
 *
 * Weeks start on Monday because that is how the work is talked about — "what is
 * on this week" means Monday to Sunday, not a rolling seven days. Computed on
 * date strings via addDays, so no zone is involved and the week that contains
 * the clocks changing is still exactly seven dates long.
 */
export function weekOf(iso: string): { from: string; to: string } {
  const [y, m, d] = iso.split("-").map(Number);
  /* getUTCDay: 0 = Sunday. Shift so Monday is 0. */
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
  const from = addDays(iso, -dow);
  return { from, to: addDays(from, 6) };
}

/** A week as it should be labelled: "13 – 19 Oct" or "29 Sep – 5 Oct". */
export function weekLabel(from: string, to: string): string {
  const fmt = (iso: string, withMonth: boolean) =>
    new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", {
      day: "numeric",
      ...(withMonth ? { month: "short" } : {}),
    });
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return `${fmt(from, !sameMonth)} – ${fmt(to, true)}`;
}

/** London's UTC offset in minutes at a given instant. +60 during BST, 0 in winter. */
function offsetMinutesAt(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    timeZoneName: "longOffset",
  }).formatToParts(instant);
  const tz = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = tz.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!m) return 0; /* plain "GMT" means +00:00 */
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
}

/**
 * A London wall-clock time turned into an instant.
 *
 * This is the awkward direction. Everywhere else in this file converts an
 * instant to a London date, which is a lookup. Going the other way — "the
 * install is at 09:00 on 13 October, what moment is that?" — means knowing
 * whether the clocks had gone forward yet, and the answer depends on the very
 * instant being calculated.
 *
 * So: interpret the wall clock as if it were UTC, ask what London's offset was
 * around then, subtract it, and check the answer still holds. The second look
 * matters only within an hour of a changeover, which is exactly when a naive
 * conversion is wrong and nobody notices until an install is an hour out.
 *
 * `new Date("2026-10-13T09:00")` would parse in the *server's* zone, which is
 * UTC on Vercel and something else on a laptop. Never use it for this.
 */
export function londonInstant(dateIso: string, time = "00:00"): Date {
  const [y, mo, d] = dateIso.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const asIfUtc = Date.UTC(y, mo - 1, d, hh || 0, mm || 0);

  const firstGuess = offsetMinutesAt(new Date(asIfUtc));
  let instant = new Date(asIfUtc - firstGuess * 60_000);
  const settled = offsetMinutesAt(instant);
  if (settled !== firstGuess) instant = new Date(asIfUtc - settled * 60_000);
  return instant;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export function isClockTime(value: unknown): value is string {
  return typeof value === "string" && HHMM.test(value);
}

