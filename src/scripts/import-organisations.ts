/**
 * Read Aurelija's pipeline spreadsheet and work out what it would become.
 *
 *   npx tsx src/scripts/import-organisations.ts <path-to-csv> [--report <file>]
 *   npx tsx src/scripts/import-organisations.ts <path-to-csv> --apply
 *   npx tsx src/scripts/import-organisations.ts --undo <batch-id>
 *
 * Dry run by default: it writes a report and touches no rows. `--apply` writes,
 * stamping every organisation and contact with a batch id it prints, so a bad
 * import can be undone by that id in one command. Running the same file twice
 * creates nothing the second time — rows are matched on their dedupe key and
 * left alone, because this is a one-off import rather than a sync and
 * refreshing would quietly overwrite anything since edited in the panel.
 *
 * The file holds real contact details for people at other companies. Keep it out
 * of the repository: `data/` is in .gitignore, and the report this writes
 * contains organisation names but no email addresses or telephone numbers, so it
 * can be read and pasted without spreading personal data further.
 *
 * What the brief says about this file, and what is done about it:
 *
 *  - Dates mix separators — 04/08/2026, 29.06.2026 and 20.07.2026 all appear —
 *    but not field order. The column is day-first; the evidence is set out in
 *    full above `readDate` and should not be re-argued. Rows that relied on
 *    that reading are still listed in the report so it stays visible.
 *  - `Select` is a leftover dropdown default and means empty, not a value.
 *  - Rows below the data are template leftovers, not records.
 *  - `Find her on LinkedIn` in the email column is a stated gap, not a blank —
 *    it goes to `contacts.gap` so the email column stays trustworthy.
 *  - Notes run to several paragraphs of real research and are preserved whole.
 */
import { config as loadEnv } from "dotenv";

/* Next.js reads .env.local automatically; standalone scripts do not. */
loadEnv({ path: [".env.local", ".env"], quiet: true });
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { organisationDedupeKey, contactDedupeKey, looksLikeEmail } from "../lib/pipeline";
import { db } from "../db";
import {
  activities as activitiesTable,
  contacts as contactsTable,
  followUps as followUpsTable,
  organisations as organisationsTable,
} from "../db/schema";

/* ------------------------------------------------------------ CSV parsing */

/** RFC 4180: quoted fields, escaped quotes, and newlines inside a field. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      /* handled by \n */
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/* ------------------------------------------------------------- normalising */

/** `Select` is the dropdown's own placeholder and means nothing was chosen. */
const PLACEHOLDERS = new Set(["select", "type", "status", "n/a", "na", "-", "—", "tbc", ""]);

function clean(value: string | undefined): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (PLACEHOLDERS.has(v.toLowerCase())) return null;
  return v;
}

/** Keeps every paragraph. Only the outer whitespace goes. */
function cleanNotes(value: string | undefined): string | null {
  const v = (value ?? "").replace(/\r\n/g, "\n").trim();
  if (!v || PLACEHOLDERS.has(v.toLowerCase())) return null;
  return v;
}

function parseTier(value: string | null): { tier: number | null; issue: string | null } {
  if (!value) return { tier: null, issue: null };
  const m = value.match(/(\d)/);
  if (!m) return { tier: null, issue: `tier "${value}" is not a number` };
  const n = Number(m[1]);
  if (n < 1 || n > 3) return { tier: null, issue: `tier ${n} is outside 1–3` };
  return { tier: n, issue: null };
}

/* `Opportunity` in the sheet is the relationship type: its four values map
   one-to-one onto the enum the schema already had, 23/18/14/2 across all 57
   rows. It was listed as unmappable in the first dry-run report; that was
   wrong, and the column had simply been looked for under the wrong name. */
const RELATIONSHIP: Record<string, "direct_client" | "venue_partner" | "referral_partner" | "agency_partner"> = {
  "direct client": "direct_client",
  "venue partner": "venue_partner",
  "referral partner": "referral_partner",
  "agency partner": "agency_partner",
};

/* Her own contact status, carried across rather than derived. 45 not contacted,
   7 emailed, 5 with a named person — which is exactly the split the brief
   described, and a useful check that the file is the one we think it is. */
const CONTACT_STATUS: Record<string, "not_contacted" | "initial_email_sent" | "have_a_contact"> = {
  "not contacted": "not_contacted",
  "initial email sent": "initial_email_sent",
  "have a contact": "have_a_contact",
};

const REFERRAL = new Set(["high", "medium", "low"]);
function parseReferral(value: string | null) {
  if (!value) return "unknown" as const;
  const v = value.toLowerCase();
  return (REFERRAL.has(v) ? v : "unknown") as "high" | "medium" | "low" | "unknown";
}

function parseMoney(value: string | null): { pence: number | null; issue: string | null } {
  if (!value) return { pence: null, issue: null };
  const digits = value.replace(/[£$,\s]/g, "").replace(/\+$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(digits)) {
    return { pence: null, issue: `estimated value "${value}" could not be read as a number` };
  }
  return { pence: Math.round(Number(digits) * 100), issue: null };
}

/**
 * This column is day-first. Settled 1 September 2026 — do not re-litigate it.
 *
 * The file mixes separators (04/08/2026, 29.06.2026, 20.07.2026), so the first
 * question was whether it also mixes field order. It does not, and three
 * independent lines of evidence say so:
 *
 *  1. Every *unambiguous* date in the column is day-first in both separator
 *     styles — 29/07, 30/07, 29.06, 20.07, 29.07. If the sheet were month-first
 *     anywhere, a first number above 12 would be impossible; they are common.
 *  2. No first number anywhere in the column exceeds 12 under a day-first
 *     reading, which is what you would expect of a consistent sheet and not
 *     what you would expect of a mixed one.
 *  3. The intervals corroborate it. The Dorchester has a last contact of
 *     06/07 against a follow-up of 20.07: exactly two weeks on a July reading,
 *     six on a June one — and two weeks is the interval Aurelija names herself.
 *     Chancery Rosewood says the same, 06/07 against a 14.07 follow-up.
 *
 * So "04/08/2026" is 4 August and "06/07/2026" is 6 July. The parser reads
 * day-first, and still reports which rows relied on that reading rather than on
 * an unambiguous value, so the assumption stays visible instead of disappearing
 * into the data. If a future file turns out to be month-first, that report is
 * where you will notice.
 */
function readDate(
  value: string | null,
): { iso: string | null; issue: string | null; assumedDayFirst: boolean } {
  if (!value) return { iso: null, issue: null, assumedDayFirst: false };
  const m = value.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (!m) {
    return { iso: null, issue: `date "${value}" is not in a recognised format`, assumedDayFirst: false };
  }
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = Number(m[3]);
  if (year < 100) year += 2000;

  /* Only interesting because both readings would parse; the answer is settled. */
  const wouldHaveBeenAmbiguous = day <= 12 && month <= 12;

  if (day < 1 || day > 31 || month < 1 || month > 12) {
    return { iso: null, issue: `date "${value}" is not a real date`, assumedDayFirst: false };
  }
  return {
    iso: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    issue: null,
    assumedDayFirst: wouldHaveBeenAmbiguous,
  };
}

/* ---------------------------------------------------------------- mapping */

type Flag = { row: number; company: string; issue: string };

type PlannedOrganisation = {
  row: number;
  dedupeKey: string;
  name: string;
  sector: string | null;
  tier: number | null;
  website: string | null;
  location: string | null;
  region: "UK" | "Dubai";
  referralPotential: "high" | "medium" | "low" | "unknown";
  relationship: "direct_client" | "venue_partner" | "referral_partner" | "agency_partner" | null;
  contactStatus: "not_contacted" | "initial_email_sent" | "have_a_contact";
  estimatedValuePence: number | null;
  notes: string | null;
  notesLineBreaks: number;
  notesChars: number;
  /* Her `Last Contact` column, read day-first. Becomes one activity — history,
     not a live follow-up: a July date on the Due screen in September would read
     as overdue when it is simply a record of what happened. `Follow Up Date` is
     deliberately not imported for that reason. */
  lastContact: string | null;
  nextAction: string | null;
  /* Her `Follow Up Date`. Imported as a *completed* follow-up: the dates are in
     July and treating them as open would put them on the Due screen now reading
     as overdue, when they have long since been dealt with. Dropping them
     instead would lose the history. Completed keeps both. */
  followUpDate: string | null;
};

type PlannedContact = {
  row: number;
  organisationKey: string;
  dedupeKey: string;
  name: string | null;
  jobTitle: string | null;
  email: string | null;
  phone: string | null;
  gap: string | null;
};

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const apply = args.includes("--apply");
  const reportAt = args[args.indexOf("--report") + 1];

  if (!file) {
    console.error("Usage: import-organisations.ts <path-to-csv> [--report <file>] [--apply]");
    process.exit(1);
  }
  const undoBatch = args.includes("--undo") ? args[args.indexOf("--undo") + 1] : null;
  if (undoBatch) {
    await undoImport(undoBatch);
    return;
  }

  const rows = parseCsv(readFileSync(file, "utf8"));
  const header = rows[0].map((h) => h.trim());
  const col = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const C = {
    tier: col("Tier"),
    company: col("Company"),
    sector: col("Sector"),
    contactName: col("Contact Name"),
    jobTitle: col("Job Title"),
    email: col("Email"),
    phone: col("Phone"),
    website: col("Website"),
    location: col("Location"),
    leadScore: col("Lead Score"),
    contactStatus: col("Contact Status"),
    opportunity: col("Opportunity"),
    lastContact: col("Last Contact"),
    nextAction: col("Next Action"),
    followUp: col("Follow Up Date"),
    value: col("Estimated Value"),
    referral: col("Referral Potential"),
    notes: col("Notes"),
  };

  const organisations: PlannedOrganisation[] = [];
  const contacts: PlannedContact[] = [];
  const flags: Flag[] = [];
  /* Read day-first per the settled reasoning above; listed, not flagged. */
  const dayFirst: Flag[] = [];
  const seenOrg = new Map<string, number>();
  let skippedTemplate = 0;
  let skippedBlank = 0;

  for (let r = 1; r < rows.length; r++) {
    const raw = rows[r];
    const rowNo = r + 1; /* 1-based, matching what a spreadsheet shows */
    const company = clean(raw[C.company]);

    if (!company) {
      /* Either a genuinely empty line, or one of the template leftovers below
         the data whose cells still hold the dropdown placeholders — `Select`,
         `Type`, `Status`. Neither is a record, but they are worth counting
         separately so the numbers can be reconciled against the sheet. */
      const hasPlaceholder = raw.some((cell) => {
        const v = (cell ?? "").trim().toLowerCase();
        return v.length > 0 && PLACEHOLDERS.has(v);
      });
      const hasRealValue = raw.some((cell, i) => i !== C.company && clean(cell) !== null);
      if (hasPlaceholder || hasRealValue) skippedTemplate++;
      else skippedBlank++;
      continue;
    }

    const dedupeKey = organisationDedupeKey(company);
    if (seenOrg.has(dedupeKey)) {
      flags.push({
        row: rowNo,
        company,
        issue: `duplicate of row ${seenOrg.get(dedupeKey)} — same organisation key "${dedupeKey}"`,
      });
      continue;
    }
    seenOrg.set(dedupeKey, rowNo);

    const location = clean(raw[C.location]);
    const region: "UK" | "Dubai" = /dubai|uae|emirat/i.test(location ?? "") ? "Dubai" : "UK";

    const tier = parseTier(clean(raw[C.tier]));
    if (tier.issue) flags.push({ row: rowNo, company, issue: tier.issue });

    const money = parseMoney(clean(raw[C.value]));
    if (money.issue) flags.push({ row: rowNo, company, issue: money.issue });

    const notes = cleanNotes(raw[C.notes]);

    organisations.push({
      row: rowNo,
      dedupeKey,
      name: company,
      sector: clean(raw[C.sector]),
      tier: tier.tier,
      website: clean(raw[C.website]),
      location,
      region,
      referralPotential: parseReferral(clean(raw[C.referral])),
      relationship: RELATIONSHIP[(clean(raw[C.opportunity]) ?? "").toLowerCase()] ?? null,
      contactStatus:
        CONTACT_STATUS[(clean(raw[C.contactStatus]) ?? "").toLowerCase()] ?? "not_contacted",
      estimatedValuePence: money.pence,
      notes,
      notesLineBreaks: notes ? (notes.match(/\n/g) ?? []).length : 0,
      notesChars: notes ? notes.length : 0,
      lastContact: readDate(clean(raw[C.lastContact])).iso,
      nextAction: clean(raw[C.nextAction]),
      followUpDate: readDate(clean(raw[C.followUp])).iso,
    });

    /* --- the person, if there is one --- */
    const contactName = clean(raw[C.contactName]);
    const emailCell = clean(raw[C.email]);
    let email: string | null = null;
    let gap: string | null = null;

    if (emailCell) {
      if (looksLikeEmail(emailCell)) email = emailCell;
      else {
        /* "Find her on LinkedIn" and similar: a stated gap, not a blank. */
        gap = emailCell;
      }
    }

    if (contactName || email || gap) {
      contacts.push({
        row: rowNo,
        organisationKey: dedupeKey,
        dedupeKey: contactDedupeKey({ email, name: contactName }),
        name: contactName,
        jobTitle: clean(raw[C.jobTitle]),
        email,
        phone: clean(raw[C.phone]),
        gap,
      });
    }

    /* --- dates, read but not imported in this slice --- */
    for (const [label, idx] of [
      ["Last Contact", C.lastContact],
      ["Follow Up Date", C.followUp],
    ] as const) {
      if (idx < 0) continue;
      const cell = clean(raw[idx]);
      const d = readDate(cell);
      if (d.issue) flags.push({ row: rowNo, company, issue: `${label}: ${d.issue}` });
      else if (d.assumedDayFirst && cell) {
        dayFirst.push({ row: rowNo, company, issue: `${label}: "${cell}" read as ${d.iso}` });
      }
    }
  }

  /* ----------------------------------------------------------- the report */
  const gapCount = contacts.filter((c) => c.gap).length;
  const emailCount = contacts.filter((c) => c.email).length;
  const withNotes = organisations.filter((o) => o.notes);
  const longNotes = withNotes.filter((o) => o.notesLineBreaks > 0);
  const noteChars = withNotes.reduce((n, o) => n + o.notesChars, 0);

  const lines: string[] = [];
  const say = (s = "") => lines.push(s);

  say("# Organisations import — dry run");
  say();
  say(`Source: ${file}`);
  say(`Nothing was written. This is a report only.`);
  say();
  say("## What it would create");
  say();
  say(`- Organisations: **${organisations.length}**`);
  say(`- Contacts: **${contacts.length}** — ${emailCount} with an email, ${gapCount} with a stated gap instead`);
  say(`- Organisations carrying notes: ${withNotes.length}, of which ${longNotes.length} run to more than one paragraph`);
  say(`- Note text preserved whole: ${noteChars.toLocaleString("en-GB")} characters; longest is ${Math.max(0, ...withNotes.map((o) => o.notesChars))}`);
  say(`- Region split: UK ${organisations.filter((o) => o.region === "UK").length}, Dubai ${organisations.filter((o) => o.region === "Dubai").length}`);
  say(`- Rows skipped as template leftovers: ${skippedTemplate}`);
  say(`- Rows skipped as blank: ${skippedBlank}`);
  say();
  say("## Rows needing a human decision");
  say();
  if (flags.length === 0) {
    say("None.");
  } else {
    say(`${flags.length} in total. Organisation names only — no email addresses or telephone numbers appear below.`);
    say();
    say("| Row | Organisation | What needs deciding |");
    say("| --- | --- | --- |");
    for (const f of flags) {
      say(`| ${f.row} | ${f.company.replace(/\|/g, "\\|")} | ${f.issue.replace(/\|/g, "\\|")} |`);
    }
  }
  say();
  say("## Dates read day-first");
  say();
  if (dayFirst.length === 0) {
    say("No date in the file needed the day-first reading to disambiguate it.");
  } else {
    say(
      `${dayFirst.length} value(s) would have parsed either way and were read day-first, per the ` +
        "settled reasoning above `readDate`. Listed so the assumption stays visible rather than " +
        "disappearing into the data.",
    );
    say();
    say("| Row | Organisation | Reading |");
    say("| --- | --- | --- |");
    for (const f of dayFirst) {
      say(`| ${f.row} | ${f.company.replace(/\|/g, "\\|")} | ${f.issue.replace(/\|/g, "\\|")} |`);
    }
  }
  say();
  say("## Columns not mapped in this slice");
  say();
  say("`Opportunity` and `Contact Status` are now mapped — to `relationship` and `contact_status`");
  say("respectively. `Opportunity` was listed here as unmappable in the first dry run; that was");
  say("wrong. Its four values are exactly the relationship enum, 23/18/14/2 across all 57 rows.");
  say("`Last Contact` is mapped as one activity per organisation that has a date, carrying her");
  say("`Next Action` text in the summary. `Follow Up Date` is mapped as a follow-up already marked");
  say("done — completed rather than open, so the history is kept without July dates appearing on");
  say("the Due screen today as overdue.");
  say();
  say("Still not imported, deliberately:");
  say();
  say("**`Lead Score` is dropped, deliberately.** It is filled on 4 of 57 rows, every one of them");
  say("the value 6, and it says what `tier` already says. Importing a column that is 93% empty");
  say("and duplicates another would give one question two answers that can disagree. If it turns");
  say("out to mean something `tier` does not, it can be added later — the source file still has it.");
  say();
  say("Still not imported:");
  say("- `Lead Score` is the only column dropped outright — see above.");
  say("- `Next Action` — carried, but as part of the activity summary rather than its own column.");
  say("- `Tier Key` — a legend beside the data, not a record.");

  const report = lines.join("\n") + "\n";
  if (reportAt) {
    writeFileSync(reportAt, report, "utf8");
    console.log(`Report written to ${reportAt}`);
  } else {
    console.log(report);
  }

  console.log(
    `\nSummary: ${organisations.length} organisations, ${contacts.length} contacts, ${flags.length} rows flagged.`,
  );

  if (apply) await applyPlan(organisations, contacts);
}

/* ------------------------------------------------------------------ writing */

/**
 * Write the plan, stamped with a batch id.
 *
 * Existing rows are matched on their dedupe key and left alone rather than
 * updated: this is a one-off import, not a sync, and refreshing a row would
 * quietly overwrite anything since edited in the panel. So running the same
 * file twice creates nothing the second time, which is the property worth
 * having and the one that proves the keys are stable.
 *
 * Ids are minted here rather than read back, because neon-http has no
 * interactive transactions — see AGENTS.md. Both inserts go into one
 * db.batch(), so either the whole import lands or none of it does.
 */
async function applyPlan(orgs: PlannedOrganisation[], people: PlannedContact[]) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const batch = `csv-${stamp}-${Math.random().toString(36).slice(2, 8)}`;

  const existingOrgs = await db
    .select({ id: organisationsTable.id, dedupeKey: organisationsTable.dedupeKey })
    .from(organisationsTable);
  const orgIdByKey = new Map(existingOrgs.map((o) => [o.dedupeKey, o.id]));

  const orgInserts: (typeof organisationsTable.$inferInsert)[] = [];
  for (const o of orgs) {
    if (orgIdByKey.has(o.dedupeKey)) continue;
    const id = randomUUID();
    orgIdByKey.set(o.dedupeKey, id);
    orgInserts.push({
      id,
      region: o.region,
      dedupeKey: o.dedupeKey,
      name: o.name,
      sector: o.sector,
      tier: o.tier,
      relationship: o.relationship,
      website: o.website,
      location: o.location,
      referralPotential: o.referralPotential,
      contactStatus: o.contactStatus,
      estimatedValuePence: o.estimatedValuePence,
      notes: o.notes,
      importBatch: batch,
    });
  }

  const orgIds = [...orgIdByKey.values()];
  const existingContacts = orgIds.length
    ? await db
        .select({
          organisationId: contactsTable.organisationId,
          dedupeKey: contactsTable.dedupeKey,
        })
        .from(contactsTable)
        .where(inArray(contactsTable.organisationId, orgIds))
    : [];
  const seen = new Set(existingContacts.map((c) => `${c.organisationId}::${c.dedupeKey}`));

  const contactInserts: (typeof contactsTable.$inferInsert)[] = [];
  for (const c of people) {
    const organisationId = orgIdByKey.get(c.organisationKey);
    if (!organisationId) continue;
    const key = `${organisationId}::${c.dedupeKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    contactInserts.push({
      id: randomUUID(),
      organisationId,
      dedupeKey: c.dedupeKey,
      name: c.name,
      jobTitle: c.jobTitle,
      email: c.email,
      phone: c.phone,
      gap: c.gap,
      importBatch: batch,
    });
  }

  /* `Last Contact` becomes one activity per organisation that has a date —
     history, not a live follow-up. `Follow Up Date` is deliberately left out:
     a July date would land on the Due screen in September reading as overdue,
     when it is a record of something already done.

     Only written for organisations this run created, so a rerun adds nothing.
     No summary is invented: it says where the row came from, and repeats her
     own Next Action text when she wrote one. `actorId` stays null because the
     spreadsheet does not say who made the contact. */
  const contactIdByOrg = new Map(contactInserts.map((c) => [c.organisationId, c.id!]));
  const newOrgIds = new Set(orgInserts.map((o) => o.id!));
  const activityInserts: (typeof activitiesTable.$inferInsert)[] = [];
  for (const o of orgs) {
    if (!o.lastContact) continue;
    const organisationId = orgIdByKey.get(o.dedupeKey);
    if (!organisationId || !newOrgIds.has(organisationId)) continue;
    activityInserts.push({
      id: randomUUID(),
      kind: o.contactStatus === "initial_email_sent" ? "email_sent" : "note",
      occurredAt: o.lastContact,
      summary:
        "Contact recorded in the pipeline spreadsheet" +
        (o.nextAction ? ` — next action: ${o.nextAction}` : ""),
      actorId: null,
      organisationId,
      contactId: contactIdByOrg.get(organisationId) ?? null,
    });
  }

  /* `Follow Up Date` becomes a follow-up already marked done. `completedAt` is
     left null rather than guessed: the spreadsheet records that a follow-up was
     set, not when it was actioned, and inventing a timestamp to fill the column
     would be worse than an honest gap. Done rows never reach the Due view,
     which filters on open — so the history is kept without July dates showing
     up as overdue today. */
  const followUpInserts: (typeof followUpsTable.$inferInsert)[] = [];
  for (const o of orgs) {
    if (!o.followUpDate) continue;
    const organisationId = orgIdByKey.get(o.dedupeKey);
    if (!organisationId || !newOrgIds.has(organisationId)) continue;
    followUpInserts.push({
      id: randomUUID(),
      dueAt: o.followUpDate,
      note: "Follow-up recorded in the pipeline spreadsheet",
      status: "done",
      completedAt: null,
      assigneeId: null,
      organisationId,
      contactId: contactIdByOrg.get(organisationId) ?? null,
    });
  }

  console.log(`\nimport batch: ${batch}`);

  if (
    !orgInserts.length &&
    !contactInserts.length &&
    !activityInserts.length &&
    !followUpInserts.length
  ) {
    console.log(
      `Nothing to write — every row is already present. ` +
        `Created 0; ${orgs.length} organisation(s) and ${people.length} contact(s) already there.`,
    );
    return;
  }

  const writes = [];
  if (orgInserts.length) writes.push(db.insert(organisationsTable).values(orgInserts));
  if (contactInserts.length) writes.push(db.insert(contactsTable).values(contactInserts));
  if (activityInserts.length) writes.push(db.insert(activitiesTable).values(activityInserts));
  if (followUpInserts.length) writes.push(db.insert(followUpsTable).values(followUpInserts));
  type Write = (typeof writes)[number];
  await db.batch(writes as [Write, ...Write[]]);

  console.log(
    `Created ${orgInserts.length} organisation(s), ${contactInserts.length} contact(s) and ` +
      `${activityInserts.length} activity row(s) from Last Contact and ` +
      `${followUpInserts.length} completed follow-up(s) from Follow Up Date; ` +
      `${orgs.length - orgInserts.length} organisation(s) and ` +
      `${people.length - contactInserts.length} contact(s) were already present.`,
  );
  console.log(
    `\nTo undo this import, one command:\n` +
      `  npx tsx src/scripts/import-organisations.ts --undo ${batch}\n\n` +
      `Equivalently, in SQL:\n` +
      `  DELETE FROM organisations WHERE import_batch = '${batch}';\n\n` +
      `Deleting the organisations cascades to their contacts and to any activity or\n` +
      `follow-up hanging off them, which is what makes the reversal a single statement.`,
  );
}

/** Remove everything one import created. The cascades do the rest. */
async function undoImport(batch: string) {
  const orgs = await db
    .select({ id: organisationsTable.id })
    .from(organisationsTable)
    .where(eq(organisationsTable.importBatch, batch));

  if (!orgs.length) {
    console.log(`No organisations carry import batch "${batch}". Nothing to undo.`);
    return;
  }
  await db.delete(organisationsTable).where(eq(organisationsTable.importBatch, batch));
  console.log(
    `Removed ${orgs.length} organisation(s) from batch ${batch}, and everything that ` +
      `cascaded from them.`,
  );
}

main().catch((error) => {
  console.error("\n" + (error instanceof Error ? (error.stack ?? error.message) : String(error)));
  process.exit(1);
});
