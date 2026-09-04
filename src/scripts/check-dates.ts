/**
 * Check src/lib/dates.ts, particularly across BST.
 *
 *   npx tsx src/scripts/check-dates.ts
 *
 * These are pure functions — no database, no network, nothing to clean up. The
 * cases that matter are the ones where the server's own idea of the date differs
 * from London's, because that is the bug the `date` columns were chosen to avoid
 * and it only shows up for one hour a night, half the year.
 */
import {
  addDays,
  dueBucket,
  isClockTime,
  isIsoDate,
  londonDateOf,
  londonInstant,
  londonTimeOf,
  todayInLondon,
  weekOf,
} from "../lib/dates";

let failures = 0;

function eq(label: string, got: unknown, want: unknown) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok ? "" : `  — got ${String(got)}, wanted ${String(want)}`}`);
}

console.log("todayInLondon — the hour where UTC and London disagree");
/* 23:30 UTC in June is 00:30 the next day in London. A server reading its own
   clock would file this under the wrong day. */
eq("2026-06-15T23:30Z is the 16th in London", todayInLondon(new Date("2026-06-15T23:30:00Z")), "2026-06-16");
eq("2026-06-16T00:30Z is still the 16th", todayInLondon(new Date("2026-06-16T00:30:00Z")), "2026-06-16");
eq("2026-07-01T23:00Z is the 2nd in London", todayInLondon(new Date("2026-07-01T23:00:00Z")), "2026-07-02");
/* In January there is no offset, so UTC and London agree. */
eq("2026-01-15T23:30Z is the 15th in London", todayInLondon(new Date("2026-01-15T23:30:00Z")), "2026-01-15");
eq("2026-01-15T00:30Z is the 15th in London", todayInLondon(new Date("2026-01-15T00:30:00Z")), "2026-01-15");
/* Midday is never ambiguous either way. */
eq("2026-08-30T12:00Z is the 30th", todayInLondon(new Date("2026-08-30T12:00:00Z")), "2026-08-30");

console.log("\naddDays — whole days, unaffected by the clocks changing");
/* BST begins on the last Sunday of March 2026 (the 29th): that local day is 23
   hours long. Adding a day must still land on the next calendar date. */
eq("28 -> 29 March, the day the clocks go forward", addDays("2026-03-28", 1), "2026-03-29");
eq("29 -> 30 March", addDays("2026-03-29", 1), "2026-03-30");
/* BST ends on the last Sunday of October 2026 (the 25th): a 25-hour local day. */
eq("24 -> 25 October, the day the clocks go back", addDays("2026-10-24", 1), "2026-10-25");
eq("25 -> 26 October", addDays("2026-10-25", 1), "2026-10-26");
eq("across a month boundary", addDays("2026-08-31", 1), "2026-09-01");
eq("across a year boundary", addDays("2026-12-31", 1), "2027-01-01");
eq("into a leap day", addDays("2028-02-28", 1), "2028-02-29");
eq("past a leap day", addDays("2028-02-29", 1), "2028-03-01");
eq("backwards", addDays("2026-09-01", -1), "2026-08-31");
eq("seven days, her follow-up shortcut", addDays("2026-08-28", 7), "2026-09-04");
eq("zero is identity", addDays("2026-08-28", 0), "2026-08-28");

console.log("\nisIsoDate — shape and reality");
eq("a real date", isIsoDate("2026-09-04"), true);
eq("29 February in a leap year", isIsoDate("2028-02-29"), true);
eq("29 February in a common year", isIsoDate("2026-02-29"), false);
eq("30 February", isIsoDate("2026-02-30"), false);
eq("month 13", isIsoDate("2026-13-01"), false);
eq("unpadded", isIsoDate("2026-2-3"), false);
eq("a timestamp is not a date", isIsoDate("2026-09-04T00:00:00Z"), false);
eq("prose", isIsoDate("next Tuesday"), false);
eq("a number", isIsoDate(20260904), false);
eq("null", isIsoDate(null), false);

console.log("\ndueBucket — overdue / next 7 days / later, rolling from today");
const today = "2026-08-30";
eq("yesterday is overdue", dueBucket("2026-08-29", today), "overdue");
eq("today is in the next 7", dueBucket(today, today), "next7");
eq("day 7 is the last day inside", dueBucket("2026-09-06", today), "next7");
eq("day 8 is later", dueBucket("2026-09-07", today), "later");
eq("long past is overdue", dueBucket("2026-01-01", today), "overdue");
eq("long future is later", dueBucket("2027-01-01", today), "later");
/* The point of rolling: on a Friday, a calendar week would have shown almost
   nothing while the real workload sat three days out. Here it does not. */
const friday = "2026-09-04";
eq("Friday + 3 days still counts as next 7", dueBucket("2026-09-07", friday), "next7");

console.log("\nlondonInstant — a wall clock turned back into a moment");
/* Mid-summer London is UTC+1, so 09:00 local is 08:00Z. */
eq("09:00 on 13 July is 08:00Z", londonInstant("2026-07-13", "09:00").toISOString(), "2026-07-13T08:00:00.000Z");
/* Mid-winter there is no offset at all. */
eq("09:00 on 13 January is 09:00Z", londonInstant("2026-01-13", "09:00").toISOString(), "2026-01-13T09:00:00.000Z");
/* The clocks go forward at 01:00 on 29 March 2026 — either side of it. */
eq("00:30 on 29 March, before the change", londonInstant("2026-03-29", "00:30").toISOString(), "2026-03-29T00:30:00.000Z");
eq("03:00 on 29 March, after the change", londonInstant("2026-03-29", "03:00").toISOString(), "2026-03-29T02:00:00.000Z");
/* And back at 02:00 on 25 October 2026. */
eq("03:00 on 25 October, after the change", londonInstant("2026-10-25", "03:00").toISOString(), "2026-10-25T03:00:00.000Z");
eq("no time given means midnight London", londonInstant("2026-07-13").toISOString(), "2026-07-12T23:00:00.000Z");

console.log("\nround trip — an instant back to a London date and time");
eq("a summer instant keeps its date", londonDateOf(londonInstant("2026-07-13", "09:00")), "2026-07-13");
eq("and its clock time", londonTimeOf(londonInstant("2026-07-13", "09:00")), "09:00");
eq("a job just after midnight stays on its own day",
  londonDateOf(londonInstant("2026-07-13", "00:15")), "2026-07-13");
eq("even though that instant is the day before in UTC",
  londonInstant("2026-07-13", "00:15").toISOString().slice(0, 10), "2026-07-12");

console.log("\nweekOf — Monday to Sunday");
eq("a Wednesday resolves to its Monday", weekOf("2026-09-02").from, "2026-08-31");
eq("and to its Sunday", weekOf("2026-09-02").to, "2026-09-06");
eq("a Monday is its own week start", weekOf("2026-08-31").from, "2026-08-31");
eq("a Sunday belongs to the week before it", weekOf("2026-09-06").from, "2026-08-31");
eq("the week the clocks change still ends on its Sunday", weekOf("2026-10-25").to, "2026-10-25");

console.log("\nisClockTime");
eq("a real time", isClockTime("09:30"), true);
eq("midnight", isClockTime("00:00"), true);
eq("hour 24", isClockTime("24:00"), false);
eq("unpadded", isClockTime("9:30"), false);
eq("prose", isClockTime("morning"), false);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
