# Phase 3 — pipeline stages, and the HubSpot question

Read `AGENTS.md` first. Written 1 September 2026 from Aurelija's feedback, which
came in two parts: a specific request that is clearly right and should be built,
and a general one — "incorporate all of HubSpot's features" — that should not be
taken literally, for reasons set out below.

## Part one: what she actually asked for

In her words: a dropdown on each record with options like *reviewed, contacted,
rejected/not relevant, meeting booked, approved*; choosing one moves the record
into that section; sections she can open to see everything at that stage without
searching or remembering. Contacts attached to the business, so that when a
person moves on the relationship is updated rather than lost.

That is a **pipeline**, and it is the right thing to want. It is also close to
what the panel already holds — it needs a stage field with her vocabulary, and a
view organised by stage rather than by list.

### The one design question it raises

She says "each lead", then describes moving *businesses* between tabs and adding
contacts to them as she meets the right people. Those are two different things in
this panel, and the distinction has been load-bearing since the Phase 2A brief:

- **Leads** are moments the scanners find — a gala on 13 November, a shoot in
  October. They happen once. Their statuses (New / Approved / Rejected) are
  triage: is this worth pursuing at all?
- **Organisations** are relationships worked over months — Harrods, Claridge's,
  Pinewood. They do not happen once, and they are what a contact belongs to.

Everything she describes — *contacted*, *meeting booked*, a contact moving on and
the relationship surviving — is the second kind. You do not book a meeting with a
gala; you book it with the charity running it.

**Recommendation: the stage lives on the organisation.** Leads keep their
three-way triage, which is a different question asked once. `organisations.
contactStatus` already exists and already holds a three-value version of exactly
this — *not contacted / initial email sent / have a contact*, imported from her
own sheet. Phase 3 widens it into her full vocabulary and gives it a view.

This also answers the lead-to-organisation question that was deliberately left
open: an approved lead is one she has decided to pursue, and pursuing it means an
account moving through the pipeline. **Approving a lead should offer to attach it
to an organisation** — existing or new — and that attachment is what puts it in
front of her on the board.

### The stages — settled 4 September 2026

She described her actual process, which is shorter than the list she first gave
and shorter than the one proposed below. In her words:

> 1. Find the venue, event, hotel, and locate the contact name of the
>    responsible person. I need to note these names… hotel connections tend to
>    move around. Noting the names gives us the opportunity to work with them in
>    their new locations… the more people I contact the harder it is to remember
>    who to speak to at each location.
> 2. Once contacted they become a follow-up. Since I rarely get a response the
>    first time, I keep a log of who I contacted and when so that I don't bombard
>    them but know when to chase.
> 3. Then they become 'a meeting' or 'in review'… Hopefully they then move to us
>    becoming their supplier.

So the stage list is **five, not eight**:

| Stage | Means |
| --- | --- |
| New | Found, contact name noted, not yet approached |
| Follow up | Contacted, waiting, being chased on a schedule |
| In review | A meeting is set, or a live conversation is running |
| Approved | Won — we are their supplier |
| Not relevant | Closed |

Both open questions are answered by that description:

- **"Reviewed" is gone.** Her "in review" means *a meeting is booked*, not "I have
  looked at it". There is no pre-contact stage, so the one that would have sat
  empty never gets built.
- **"Have a contact" is not a stage.** Noting the name is part of step 1, before
  any approach — it is a property of a found opportunity, not a position on the
  line. The five organisations marked that way collapse into **New**. This also
  explains why it never fitted: it was never on the same axis.

Her reason for wanting names recorded is worth keeping in view, because it is a
requirement rather than a preference: *hotel people move, and she wants to follow
them to the new hotel.* The panel already models this correctly — contacts belong
to an organisation and survive it — but "where did this person go" is a query
nothing currently answers.

### The earlier proposal, kept for the record

Superseded by the five above. Left here because the reasoning about ordering and
enum storage still applies:

| Stage | Means |
| --- | --- |
| Not contacted | On the list, nothing sent |
| Reviewed | Looked at and worth pursuing, not yet approached |
| Contacted | Approached, no reply yet |
| In conversation | They replied; it is live |
| Meeting booked | A date in the diary |
| Quote sent | A number is with them |
| Client | Won — they have booked work |
| Not relevant | Closed, with a reason |

Two things worth deciding with her rather than for her:

- **Is "reviewed" doing work?** If nothing separates it from "not contacted" in
  practice, it is a stage she will never move anything into, and an unused stage
  is clutter on every screen. Worth asking what she would do differently to a
  reviewed record.
- **"Approved" she listed, but it may be the lead-triage word rather than a
  pipeline stage.** Worth checking whether she means "approved as a target" —
  which is "reviewed" — or the existing lead approval.

Whatever the list, it is **stored as an enum and ordered**, so the board can lay
the stages out left to right and the counts mean something.

### What it looks like

- `/organisations` grows a **board view** alongside the list: one column per
  stage, each card showing the organisation, its contacts count, and its next
  follow-up. The existing filter chips stay for people who prefer a list.
- The stage is a **dropdown on the card**, exactly as she described. Changing it
  moves the card and writes an audit row — who moved it, when, from where to
  where. `job_events` is the pattern to copy; organisations need the equivalent.
- **Every stage change is a decision**, so the same rule that protects lead
  status applies: nothing automated may overwrite it.
- A stage change should offer to set a follow-up, the way completing one already
  does. Moving something to "Contacted" with no reminder to chase is how things
  go quiet.

### What already exists that she may not have seen

Worth showing her before building anything, because some of this is her request
already delivered and she has not seen the screen:

- All 57 organisations with contacts, notes and history attached — `/organisations`.
- Contacts belong to the organisation, not to a lead, so a person moving on
  leaves the account and its history intact. That is already true.
- Follow-ups with a Due screen; completing one offers to set the next.
- Filters by tier, relationship and contact status, with counts.

## Part two: the HubSpot question

### What HubSpot actually is

Six product areas over a shared CRM: **Sales** (pipelines, sequences,
forecasting), **Marketing** (email campaigns, ads, landing pages, chat),
**Service** (ticketing, SLAs, knowledge base), **Content** (websites, blogs,
CMS), **Data** (sync, webhooks, programmable automation) and **Revenue**
(quote-to-cash, payments). It is a platform built by thousands of people for
companies with sales teams and marketing departments.

### Why "incorporate all its features" is the wrong target

Not because it is ambitious. Because most of it answers questions Balloonista has
not got.

1. **Most of it is irrelevant.** Content Hub is a website builder — Balloonista
   has a website. Service Hub is a support desk with SLAs and ticket routing —
   there is no support queue. Marketing Hub is ad management and landing pages.
   Revenue Hub is quote-to-cash for teams with a finance function. Building any
   of it would be building for a company that does not exist yet.

2. **A large part of the rest is automated outreach, which this project has
   ruled out from the start.** HubSpot's centre of gravity in sales is
   *sequences*: automatic follow-up emails, cadences, workflows that fire on a
   stage change. `AGENTS.md` says, and has said since Phase 1: *nothing in this
   application contacts anyone; no automated outreach, ever; Aurelija approves
   each lead by hand and makes contact herself.* That rule is not an oversight to
   be tidied away — it is why the panel can hold real contact details for people
   at other companies without being a mailing machine. Adopting HubSpot's
   automation wholesale would mean deleting it.

   This is worth putting to Aurelija directly rather than deciding for her. If
   she does want automated sending, that is a legitimate thing to want and a
   legitimate thing to change — but it is a deliberate reversal, discussed and
   written down first, not something that arrives as a side effect of "make it
   like HubSpot".

3. **It costs the jobs board.** Every week spent cloning HubSpot is a week not
   spent on the calendar sync she also asked for.

### What to take from HubSpot

The parts she is actually describing, all of which are small:

| HubSpot idea | Status here |
| --- | --- |
| Pipeline stages with a board view | **Build in Phase 3** — this is her request |
| One record per company, everything attached | Done |
| Contacts belong to companies and survive people leaving | Done |
| Activity timeline per record | Done |
| Tasks and reminders | Done — follow-ups and Due |
| Deal value, and a total by stage | Small addition — `estimatedValuePence` exists |
| Saved views and filters | Partly done — chips; saved views would be new |
| Required fields per stage | Worth considering — e.g. cannot reach "Quote sent" without a value |

### What to refuse, and say so out loud

Automated email sequences and workflows. Marketing campaigns, ads, landing pages,
chatbots and forms. Ticketing and SLAs. CMS. Payments and quote-to-cash. None of
these are close calls, and listing them here means nobody has to relitigate each
one when it comes up.

### The fair question: should you just use HubSpot instead?

It deserves a straight answer rather than a defence of work already done.

**The case for HubSpot.** The free tier gives contact management, one pipeline
with up to ten stages, email tracking, forms and basic reporting, and would hold
Balloonista's data comfortably — 57 organisations, 44 contacts, 64 leads is small.
It is mature, someone else maintains it, and Aurelija has already seen it and
likes it.

**The case against, and why I would keep the panel.**

- **Two users on the free tier.** Balloonista already has three people on the
  allow-list. Going beyond that is per-seat, per-month, forever.
- **The scanners have nowhere to go.** Four Claude scheduled tasks post leads to
  `/api/leads/ingest` and read a feedback digest that shapes their next run. That
  loop is the actual differentiator here and there is no HubSpot equivalent —
  you would be paying for a CRM and still building the interesting half.
- **The GAP convention would not survive.** "Contact could not be verified" is a
  first-class value in this panel, enforced by a database constraint. In HubSpot
  it is an empty field, and an empty field is indistinguishable from one nobody
  has filled in yet.
- **The jobs board is coming.** Google Calendar as the source of truth, with the
  operational layer around it, is not something HubSpot does.
- **The work is done.** Schema, import, screens and write paths exist and are
  tested.

**A middle path worth naming and rejecting:** using HubSpot for the CRM half and
the panel for the scanner half. It sounds reasonable and would be worse than
either — two systems, two places to look, and a sync to maintain between them,
which is precisely the "difficult to use and keep updated" problem she started
with.

So: keep the panel, take HubSpot's stage model, and leave the rest.

## The open question: one screen, or two

Her closing paragraph is the part that is not yet settled:

> When we look at the lead desk, the opportunities should be on the main screen
> under the headings (Can we add hotels?) so then I would have follow up, In
> review and Approved.

Two things are tangled in that sentence and they should be separated before
anything is built.

**One list, not two.** She says plainly that keeping a separate list defeats the
purpose. The moments-versus-relationships split is right about the data and may
still be wrong about the screen: she experiences one thing — opportunities she is
working, at stages. The likely answer is not to merge the tables but to give her
one working board where an unattached lead sits in **New** alongside the accounts,
and approving it attaches it to an organisation from that point on. That is the
lead-to-organisation link already deferred once, and her feedback is the argument
for building it.

**"Can we add hotels?"** is ambiguous and should be put back to her rather than
guessed. The two readings are different pieces of work:

- *A fifth scanner for hotels.* The four today are Film, Retail, Events and
  Channel; there is no hotels scanner, yet Hotel is the largest sector in her own
  list at 15 of 57.
- *Her hotel accounts appearing on the lead desk.* They already exist as
  organisations; they are simply on a screen she has not seen.

Ask which she means. If it is the first, it is a scanner prompt and a scheduled
task. If it is the second, it is the one-board question above and nothing new.

## Sequencing

Phase 3 is small and should not displace the jobs board for long.

0. **Show her `/organisations`** and settle the stage vocabulary. Nothing below
   should be built before that conversation — the stage list is hers.
1. Schema: widen `contactStatus` into an ordered `pipeline_stage`, add
   `organisation_events` for the audit trail. One additive migration; the
   existing three values map forward cleanly.
2. Stage dropdown on the organisation card, writing through a route that mirrors
   the lead status route, with its audit row and viewer-role refusal.
3. Board view on `/organisations`, one column per stage, with counts and value
   totals. List view stays.
4. A stage change offers a follow-up, the way completing one already does.
5. Attach an approved lead to an organisation — the link deliberately left out of
   Phase 2A, now with a reason to exist.

## Not in this phase

Automated anything. Reporting beyond counts and totals. Custom stages configurable
in the UI — a fixed enum until the vocabulary has stopped moving, because a
user-editable stage list is a much larger piece of machinery than it looks.
