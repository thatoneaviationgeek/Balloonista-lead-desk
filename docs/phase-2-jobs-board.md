# Phase 2 — the jobs board

Read `AGENTS.md` first for the house rules. This document is the brief for the
next module. Phase 1 (the lead desk on Postgres, with Google sign-in and
approve/reject) is done and working.

## What it is for

Aurelija tracks booked-in work in **Google Calendar** today, and that stays the
source of truth. The jobs board is not a replacement for her calendar — it is
the view that answers questions the calendar cannot:

- What is on this week, and what is unresourced?
- Which confirmed jobs have nobody assigned?
- Which enquiry did this job come from, and which lead before that?
- What is the value of what is booked?

If a change belongs in the calendar, it goes to the calendar. The panel adds
the operational layer around it.

## Access to Google — settled

**Decided 29 August 2026: domain-wide delegation.** Both Jimmo and Aurelija hold
Workspace super-admin on the domain, so the authorisation step in Admin console →
Security → API controls → Domain-wide delegation can be done in house. No OAuth
consent screen, no Google verification submission, no per-user connect step, and
no 7-day refresh-token expiry to work around.

Consequences: the service account reads the calendar server-side under a
`calendar.readonly` scope — the panel never writes to Google, so read-only is the
correct grant and the easier one to authorise. `google_accounts` stays in the
schema but is **unused**; do not build against it. The reasoning behind the two
options is kept below for the record.

The team is a mix: some on the Balloonista Workspace domain, some on ordinary
Gmail addresses. That rules out the tidy options and leaves two:

1. **Domain-wide delegation (preferred).** A Workspace service account,
   authorised by a super-admin in Admin console → Security → API controls →
   Domain-wide delegation. Reads the business calendar server-side. No OAuth
   consent screen, no Google verification submission, no per-user connect step.
   Needs someone with super-admin on the domain.
2. **Per-user OAuth (fallback).** Each person connects their own account.
   Calendar scopes are *sensitive*, so the External OAuth app then needs
   Google verification — a real submission with screenshots and a privacy
   policy — or it stays in Testing mode where refresh tokens die after 7 days.

Do not start the sync until this is settled. The `google_accounts` table in the
schema exists for option 2 and is unused under option 1.

## Data model

`jobs` and `tasks` already exist in `src/db/schema.ts` and the initial
migration — no new migration needed to start. Fields worth noting:

- `calendarEventId` + `calendarId` — the link back to Google, unique on
  `calendarEventId`, which is what makes the sync idempotent.
- `leadId` — set when a job came from an approved lead.
- `status` — enquiry → quoted → confirmed → delivered → invoiced (or cancelled).
- `valuePence` — integer minor units, never a float.

Likely additions once the sync is real: a `calendar_sync_state` table holding
Google's incremental `syncToken` per calendar, and `sourceUpdatedAt` on `jobs`
so a calendar edit can win over a stale local copy.

`jobs.sourceUpdatedAt` is nullable, so a manually-created job has NULL in it. The
Stage 2 `setWhere` must therefore be written
`jobs.source_updated_at IS NULL OR excluded.source_updated_at > jobs.source_updated_at` —
a bare `>` against NULL evaluates to NULL rather than true, so the update would be
silently skipped and the job would never pick up its calendar link.

## The sync

- A Vercel Cron route (`/api/cron/calendar`) every 15 minutes, plus a manual
  "sync now" button for when someone has just changed the calendar.
  **Confirmed 29 August 2026: the account is on Vercel Pro**, so a 15-minute
  cadence stands as originally planned — the once-a-day cron limit that would
  have forced a rethink applies to Hobby only.
- Use Google's **incremental sync tokens**, not a full list every run. Fall
  back to a full sync when Google returns 410 Gone.
- Match on `calendarEventId`. Insert what is new, update what changed, and mark
  cancelled events rather than deleting rows — the audit trail matters.
- **Never let a sync overwrite a field a human set in the panel.** The calendar
  owns the when and the title; the panel owns status, owner, assignments,
  value and notes. This is the same rule as the lead ingest: a rerun refreshes
  facts, never decisions.
- Recurring events: expand instances, do not store the series as one job.
- All-day events and time zones: everything stored UTC, rendered Europe/London.

## Which calendars — settled

**Decided 29 August 2026: one shared Balloonista calendar.** The unique index on
`calendarEventId` alone is therefore correct as it stands and must not be widened.
`calendarId` is still populated on every job, so adding calendars later is a
migration rather than a redesign — but note that it would be a migration against
live rows, and the index would need to become `(calendarId, calendarEventId)`
because Google event IDs are unique per calendar, not globally.

## UI

Follow the lead desk. Same tokens in `src/app/globals.css`, same card and chip
vocabulary, WCAG 2.2 AA on anything new. Add a nav between Leads and Jobs in
the app bar.

- `/jobs` — this week by default, with week and month views and a status filter.
- A job card showing client, venue, date and time, type, status, owner, value.
- A clear flag on confirmed jobs with no owner — that is the whole point.
- A job detail view with its tasks and, where relevant, the lead it came from.
- Manual job creation, for work that never touched the calendar.

## Acceptance

- A calendar event appears as a job within 15 minutes, without duplicates.
- Editing that event's time in Google moves the job; editing its status in the
  panel survives the next sync untouched.
- Deleting the event marks the job cancelled rather than removing it.
- A second sync run creates nothing new — same idempotency proof as the leads
  import, and worth a script that demonstrates it.

## Not in this phase

Automated messaging of any kind, invoicing, quotes, and anything that contacts
a client. Read `AGENTS.md`: nothing in this application contacts anyone.

---

## Note on the scanners (Phase 4 context)

The four scanners run as **Claude scheduled tasks**, not as code we control.
That has one consequence worth knowing now: the panel can *report* on runs but
cannot *trigger* them, because there is nothing to call. Two honest options
when we get there:

1. Leave triggering out. The panel shows run history and health from the
   `agent_runs` rows that `/api/leads/ingest` already writes. Cheap, useful.
2. Add a "run requested" flag the scheduled task checks on its next firing —
   a queue, not a trigger. Slower, but it puts the button in the panel.

Rewriting the scanners as code we run ourselves is a much larger job and should
not be smuggled into Phase 4 without deciding to do it.
