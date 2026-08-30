# Phase 2A — the working pipeline (thin slice)

Read `AGENTS.md` first. This comes **before** the jobs board in
`docs/phase-2-jobs-board.md`, which is blocked on calendar access. Stage 0 of
that brief is already done and nothing here conflicts with it.

## Why this exists

Aurelija's feedback, 29 August 2026, in her words: the lead desk is good, but
she is still running the actual work in a spreadsheet that is "difficult to use
and keep updated". She wants to record that she emailed Emma at the Chain of
Hope Gala Ball on 28 August, and be reminded to follow up in a week or two. Her
phrase for what she wants is "an internal HubSpot".

She also asked for a way to tell the scanners when an opportunity was useful or
not, so they improve.

## The thing to understand before designing anything

Her spreadsheet and the lead desk are **not the same list**.

- The lead desk holds **moments** the scanners find: a gala on 13 November, a
  Netflix shoot in October. They happen once.
- Her spreadsheet holds **relationships**: 57 organisations — Harrods,
  Claridge's, McQueens, Pinewood — that she is working over months and years.
  The scanners found none of them; she built that list herself. Only 12 have
  been contacted (7 emailed, 5 with a named contact).

Merging them into one list damages both. Linking them is the whole point: the
gala is a moment, Emma is a contact at an organisation, the email on Friday is
an activity, and the follow-up is due next week. That chain is what a
spreadsheet cannot do and what she is asking for.

**The UI in this slice is thin. The schema is not.** Getting the shape right now
costs little; reshaping it after her 57 organisations are imported costs a lot.

## Schema

One migration. Follow the Stage 0 conventions in `src/db/schema.ts`.

- **`organisations`** — name, sector, tier (1–3, nullable), relationship type
  (`direct_client`, `venue_partner`, `referral_partner`, `agency_partner`),
  website, location, region (defaults `UK`), referral potential
  (`high`/`medium`/`low`/`unknown`), estimated value in pence as an integer,
  notes, timestamps.
- **`contacts`** — organisationId, name, job title, email, phone, notes,
  timestamps. Plus a `gap` text column: her spreadsheet frequently records
  "Find her on LinkedIn" in the email field, which is the same honest
  no-contact-found convention the scanners use as `GAP — …`. It must survive as
  a stated gap, not be scrubbed to a blank.
- **`activities`** — what a *person* did: kind (`email_sent`, `email_received`,
  `call`, `meeting`, `quote_sent`, `note`), `occurredAt` as a **date**, a
  one-line summary, actorId, and nullable links to lead, organisation and
  contact. At least one link must be set.
- **`follow_ups`** — dueAt as a **date**, note, status (`open`, `done`,
  `cancelled`), assigneeId, completedAt, nullable links to lead, organisation
  and contact, timestamps.
- **`lead_feedback`** — leadId, actorId, verdict (`useful` / `not_useful`),
  reason enum, free-text note, timestamps. One row per lead per person,
  updatable — she is allowed to change her mind.
- **`leads.organisationId`** — nullable, so a scanner lead can be attached to an
  account she already works.

Use `date`, not `timestamp`, for `occurredAt` and `dueAt`. "Follow up on 4
September" is a day, not an instant, and storing it as a timestamp invites the
off-by-one-day bug every time it crosses BST.

The reason enum is fixed on purpose: `wrong_location`, `wrong_sector`,
`too_small`, `already_client`, `bad_timing`, `contact_unusable`, `other`. Free
text alone drifts to "no" and "not right", which cannot be aggregated into
anything a scanner prompt can use. The note catches what the list misses.

## UI

Follow the lead desk. Same tokens in `globals.css`, same card and chip
vocabulary, WCAG 2.2 AA on anything new, both themes.

- On a lead card: **Log contact** (kind, date, who, one line) and **Set
  follow-up** (date, with 1 week / 2 weeks / 1 month shortcuts). Logging against
  a contact that does not exist yet should create it inline rather than sending
  her somewhere else first.
- These two sit in the existing `.actions` row and show once a lead is
  **Approved**, where Approve/Reject have already collapsed to a decision line
  plus Undo — so the button count never grows and triage stays uncluttered.
  **On a lead still marked New, show them anyway and confirm explicitly:**
  "This will mark the lead Approved." Decided 30 August 2026. All 64 leads are
  currently New, Chain of Hope among them, so hiding the action would hide it
  exactly where she first needs it — and changing her lead's status silently
  would be worse. The confirmed status change writes a `lead_events` row like
  any other, with a note recording that it came from logging contact, so the
  audit trail says who and why.
- A **Due** view: **overdue / next 7 days / later**, the 7 days rolling from
  today. This is the screen she opens in the morning, so it is the one worth
  getting right. Decided 30 August 2026, replacing "due this week": a calendar
  week collapses on a Friday, so she would open it to near-nothing while the
  real workload sat three days out. Rolling is also unambiguous, which "this
  week" is not.
- **Useful / Not useful** on each lead. Not-useful asks for a reason from the
  fixed list; useful does not ask for anything. Never make her justify a yes —
  that is the action we want more of.
- Activity history visible on the lead it belongs to, newest first.

## The feedback loop must be completed, not half-built

Feedback that no scanner ever reads is theatre. This slice includes
`GET /api/feedback/digest`, authenticated with the existing `INGEST_KEY`,
returning a compact summary — counts by reason, and a handful of recent
examples on each side with their reasons — in a form that can be pasted into a
scanner's prompt. Structured JSON, with the pasteable block as a `promptText`
field, so the aggregate stays queryable and the rendering lives in one place
rather than in four scanner prompts.

**Boundary, decided 30 August 2026.** `INGEST_KEY` is a write credential held by
the scanners; this endpoint makes it a read credential too, so what it can read
is drawn deliberately. The digest carries lead-level material only — verdicts,
reasons, and her free-text notes about the lead. It carries **no contact names,
email addresses or phone numbers**, ever. Third-party personal data has no
business in a scanner prompt, and the endpoint is the place to enforce that
rather than trusting each caller to filter.

Be honest in the UI copy about what this does. The scanners are Claude
scheduled tasks; nothing is being fine-tuned. Her verdicts make the next run's
prompt better. That is genuinely worth doing and it is not machine learning.

## A rule clarification, not a change

`AGENTS.md` says nothing in this application contacts anyone. That stands. This
slice records that **a person** made contact; it sends nothing to anyone.

Reminders are in-panel only for now. A morning digest email to Balloonista staff
may come later, and if it does, the rule gets amended explicitly first — email
to staff only, never to a prospect, written down before it is built.

## Deleting a contact

The panel is about to hold third-party personal data — named people at other
companies, with emails and phone numbers. That is an ordinary business CRM and
it sits behind a login, so nothing here is wrong. But a contact must be
genuinely deletable rather than merely hidden, and that is far cheaper to build
now than to retrofit. Decided 30 August 2026.

- **Hard delete, not a flag.** The row goes. Name, job title, email, phone,
  notes and gap all go with it.
- **Activities and follow-ups survive, anonymised** — `contact_id` is
  `ON DELETE SET NULL`, not cascaded. Deleting a person must not destroy the
  record that Balloonista contacted that organisation on that date; the
  organisation-level fact is business history and is not personal data.
- **This is why `activities_contact_implies_org` exists.** Every activity or
  follow-up naming a contact also names their organisation, so nulling the
  contact always leaves a surviving link and can never trip
  `activities_has_link`. Without it Postgres would refuse the delete outright.
- **Free text is the part FK rules cannot solve.** A summary reading "Emailed
  Emma about the gala" still names her. So the delete path is a procedure, not a
  single statement: it lists every activity and follow-up referencing the
  contact, hard-deletes the contact, and reports the rows whose free text a
  person should review. Automatically scrubbing that text would destroy genuine
  business detail; pretending the problem does not exist would be worse.

## Not in this slice

The import of her 57 organisations (next), an organisations browse and edit
screen, the digest email, and the change to the scanners' own prompts — that
last one is a separate job on the scheduled tasks, and the panel half is
useless without it, so it should follow immediately.

## Acceptance

- Log an email to Emma at the Chain of Hope Gala Ball, dated 28 August 2026, set
  a follow-up a week out, and see it appear in Due — the exact thing she asked
  for, end to end.
- That follow-up moves from "later" to "due this week" to "overdue" as dates
  pass, and completing it takes it off the list without deleting the history.
- Mark a lead not useful with a reason; it appears in the digest endpoint.
- A scanner rerun through `/api/leads/ingest` does not disturb any activity,
  follow-up or feedback attached to a lead. Same rule as status: reruns refresh
  facts, never decisions.

## Note on her spreadsheet, for whoever does the import

- Dates are inconsistent — `04/08/2026`, `29.06.2026`, `20.07.2026` all appear.
  Do not guess. Wrong dates here produce wrong follow-ups, which is precisely
  the thing she is asking the system to get right. Surface ambiguous rows for a
  person to resolve.
- `Select` is a leftover dropdown default sitting in Lead Score, Referral
  Potential and Contact Status. It means empty. Imported literally it becomes a
  fake value in a real column.
- Rows below the data are empty template rows (`Select`, `Type`, `Status`) and
  are not records.
- Some Notes cells carry several paragraphs of genuine research — the Harrods
  entry weighs which of three doors to knock on. Preserve them whole.
