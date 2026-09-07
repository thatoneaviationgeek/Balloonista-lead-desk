# Phase 4 — the scanner bridge, and enrichment endpoints

Written 7 September 2026, after two findings on the same afternoon. Read
`AGENTS.md` first; the outreach rule and the never-invent rule govern every
stage below.

**Finding one.** `docs/scanner-prompt-changes.md` Block A tells a scanner to
`POST /api/leads/ingest` with an `x-ingest-key` header. The scanners are Claude
scheduled tasks, and that runtime **cannot do it**: its only web access is
`WebFetch`, which is a plain GET with no custom headers, and its shell cannot
open a connection to anything but package registries — confirmed today with a
`curl` to `balloonista-lead-desk.vercel.app` (CONNECT refused by the egress
proxy) and to `find-tender.service.gov.uk` (same). A `WebFetch` GET of
`/api/health` on production works and returns `{"ok":true,"db":"up"}`. So: the
scanners can *read* from the panel today, and cannot *write* to it, and no
prompt wording changes that. Block A has never run and cannot run as written.

**Finding two.** Aurelija's verdict on the first two new scanners: "great, but
a lot of 'no info' lines". About half of those GAPs are the runtime again — no
API keys, no auth headers, no JavaScript rendering, so Companies House is
unusable, 10times returns binary, and three of the four seed shows' exhibitor
lists render empty. The other half is data that is genuinely unpublished, where
GAP is the right answer but can carry a next step.

Both findings have the same fix: **the panel becomes the data layer.** It holds
the keys and the browser; the scanners keep the judgement. This document is the
build brief for that, in the order that unblocks the most soonest.

---

## Stage 0 — what is true today

- Production (`balloonista-lead-desk.vercel.app`) serves the v2 app; `/api/health`
  returns JSON with the database up.
- A scheduled task can `WebFetch` any public URL (GET, follows same-host
  redirects, no headers, response passed through a summarising model — keep
  responses small and plainly structured).
- A scheduled task has the Google Drive and Gmail connectors. It can create a
  file in a Drive folder (this is how the sheets are written today) and send
  email.
- `INGEST_WRITE_KEY` and `INGEST_READ_KEY` exist in the environment. Neither has
  ever been used by a scanner.
- `/api/leads/ingest` has the upsert logic we want, inline in the route handler.

---

## Stage 1 — the drop-box bridge (scanner → panel)

> **Status: built and verified end to end 7 September 2026** — `npm run
> check:bridge -- --drive` green against the real inbox, including the
> service account moving a file it does not own from `inbox` to `processed`.
> One Google rule learned on the way: a service account has no storage quota,
> so it cannot *create* files in a My Drive folder (403). The bridge never
> needs it to — the scanners create files as Jimmo through the Drive
> connector — but the harness now asks a person to drop the fixture in.
> Not yet deployed: the six variables need adding in Vercel, then a deploy.
> The exhibitions scanner writes the drop-box file from its 9 September run. `src/lib/ingest.ts`
> (shared upsert + pause flag), `src/lib/google-drive.ts`,
> `src/lib/ingest-bridge.ts`, `/api/cron/pull-ingest`, migration
> `0006_phase4_ingest_bridge`, `npm run check:bridge`. Stage 2 is in the same
> change. What remains is the Drive folder, the service account, the six
> environment variables, `npm run db:migrate`, and a first `--drive` run of
> the harness against production. Then Block A′ goes into one scanner.

**Decided 7 September 2026, with Jimmo: Drive drop-box, pulled by a cron.** The
scanner writes its batch as a JSON file into a Drive folder it can already
reach; the panel collects it on a schedule. No header, no POST, nothing the
runtime cannot do. The alternatives were a GET ingest with the batch in the URL
(fragile past a handful of leads) and moving the scanners into the backend now
(the right end state, but weeks before anything improves).

### The folder

One Drive folder, **`Balloonista Ingest`**, with three subfolders: `inbox`,
`processed`, `failed`. Share the folder with the panel's service account email
as **Editor** — that is all the access it needs and it needs no domain-wide
delegation (that decision belongs to the calendar sync in Phase 2 and is
independent of this). Record the three subfolder ids in
`INGEST_DRIVE_INBOX_ID`, `INGEST_DRIVE_PROCESSED_ID` and
`INGEST_DRIVE_FAILED_ID` — explicit rather than looked up by name, so a
renamed folder cannot silently redirect the flow.

Keep it separate from `Balloonista Lead Agents` (the sheets folder Aurelija
sees). The inbox is machine traffic; nothing in it is for reading by hand.

### What the scanner writes

File name `run-<agent>-<region>-<YYYY-MM-DD>-<HHmm>.json`, e.g.
`run-exhibitions-uk-2026-09-09-1004.json`. The name is for humans and for
ordering; **the body is authoritative** and is exactly the Block A body:

```json
{
  "region": "UK",
  "agent": "Exhibitions",
  "meta": { "window": "2026-10-21..2026-12-02", "capHit": false, "notes": "…" },
  "leads": [ { "id": "…", "title": "…", "fit": "High", "what": "…", "where": "…",
               "entity": "…", "address": "…", "contact": "…", "role": "…", "src": "…" } ]
}
```

Written with the Drive connector's `create_file`: `parentId` = inbox folder id,
`textContent` = the JSON, `contentMimeType` = `application/json`. If the
connector refuses that mime type, `text/plain` with the `.json` name is fine —
the puller parses the body, not the type. One file per run, always, **even at
zero leads** (`"leads": []`), so a run is visible as a run.

### What the panel does

`GET /api/cron/pull-ingest`, on Vercel Cron every 15 minutes
(`"schedule": "*/15 * * * *"` in `vercel.json`), guarded the way Vercel
documents: `Authorization: Bearer ${CRON_SECRET}`. Vercel sets that header on
its own invocations; nobody else can.

Per invocation:

1. List `inbox` via Drive REST v3 (`files.list` with `'<inbox-id>' in parents`,
   ordered by `createdTime`), take at most 10 files.
2. For each: download, parse, validate the shape (`region`, `agent`,
   `leads[]`), then call **`ingestBatch(body, { source: "drive", fileId })`** —
   the upsert loop lifted out of `src/app/api/leads/ingest/route.ts` into
   `src/lib/ingest.ts`, so the route and the cron share one implementation and
   one test. The route keeps working exactly as it does now.
3. Record the file in a new table so a file is never processed twice:

   ```
   ingest_files
     drive_file_id   text primary key
     file_name       text not null
     run_id          uuid references agent_runs(id)
     status          'ok' | 'failed'
     error           text
     processed_at    timestamptz not null default now()
   ```

   Insert with `onConflictDoNothing` **before** running the upsert; if the
   insert affected no rows, another invocation has it — skip. This is the same
   let-the-constraint-settle-it shape as the leads upsert, and it is what makes
   overlapping cron runs safe.
4. Move the file to `processed` (`files.update` changing `parents`); on any
   error, to `failed`, with the error in `ingest_files.error` and
   `agent_runs.error`. Never delete.

`agent_runs.meta` gets the scanner's `meta` plus `{ "source": "drive",
"fileName": … }`, so the runs view can show where a run came from.

### Environment

```
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY=     # the PEM, newlines as \n
INGEST_DRIVE_INBOX_ID=
INGEST_DRIVE_PROCESSED_ID=
INGEST_DRIVE_FAILED_ID=
CRON_SECRET=
```

**Built 7 September 2026 with no new dependency:** the service-account token
is a self-signed RS256 JWT made with `node:crypto` and exchanged at Google's
token endpoint (`src/lib/google-drive.ts`), and the three Drive calls are plain
`fetch` against REST v3. `google-auth-library` was the plan; forty lines with
nothing to audit was better.

### Testing

`src/scripts/check-ingest-bridge.ts`: writes a fixture file into `inbox` with
the service account, invokes `ingestBatch` on it directly, asserts one
`agent_runs` row and the right `created`/`duplicate` counts, asserts a second
pass of the same file id is a no-op, and asserts that a lead whose `status` was
set by hand keeps it. Run it against a scratch Neon branch, not production.

The Deployment Protection trap from `docs/phase-2-jobs-board.md` applies:
test the cron on production, or with a Protection Bypass token on a preview.
Do not disable protection.

### The scanner prompt change — Block A′

Replaces Block A in `docs/scanner-prompt-changes.md`:

> ## Reporting your results
>
> When you have finished, write your findings as ONE JSON file into the Drive
> folder `Balloonista Ingest / inbox` (folder id `<INGEST_DRIVE_FOLDER_ID>`),
> using the Drive connector's create_file with parentId set to that id, the
> file named `run-<agent>-<region>-<date>-<time>.json`, and the body in exactly
> this shape: *(the JSON above)*. Write the file even if you found nothing.
> Do not write a spreadsheet. Do not try to POST to the panel — you cannot,
> and a failure there is not a reason to retry anything. Then send the alert
> email as usual, naming the file you wrote.

The sheets stop being written the run after the bridge is live, per scanner.
Until then every scanner keeps writing its sheet; nothing is switched off
before its replacement has been seen to work.

---

## Stage 2 — reads with the key in the query string

`checkScannerKey(request, "read")` also accepts `?key=<INGEST_READ_KEY>`.
**Read purpose only.** The write path stays header-only and, after Stage 1, is
used by nothing but local tests. Then Block B works as a GET:

```
https://<host>/api/feedback/digest?agent=Exhibitions&region=UK&key=…
```

A key in a URL is logged — Vercel function logs, any proxy. Accept it with eyes
open: it is a read-class key that reveals counts, reason codes and Aurelija's
own notes and nothing about contacts; it is already in plain text inside the
scheduled-task prompts; and the mitigation is the rotation moment the
prompt-changes doc already argues for. Strip `key` from anything the app logs
itself.

---

## Stage 3 — enrichment endpoints (the depth)

All `GET`, all JSON, all reachable by `WebFetch`, all guarded by a **new
`ENRICH_KEY`** in the query string via the same helper (a third purpose,
`"enrich"`). It is its own key because these endpoints spend money and quota,
and because one of them fetches arbitrary pages on the panel's behalf — a
different privilege from reading a digest.

Shared plumbing, built once in `src/lib/enrich/`:

- **A cache table** `enrich_cache (key text primary key, body jsonb, fetched_at)`
  with a per-endpoint TTL. A scanner that reruns weekly must not re-spend quota
  on the same company or the same page.
- **A quota table** `enrich_quota (endpoint, day, count)` for anything metered.
  Over quota returns `429 { "error": "quota", "resetsAt": … }` so the scanner
  falls back to plain `WebSearch` rather than hammering.
- **Every response carries `source` (the URL the facts came from) and
  `fetchedAt`**, so the scanner can cite it as the lead's `src` honestly.
- **Responses are facts, never decisions.** Nothing in this stage writes to
  `leads`. The scanner reads, judges, and reports; the never-invent rule is the
  scanner's to keep and these endpoints must not make it easier to break —
  see the email-pattern endpoint in particular.

### 3a. Companies House — `/api/enrich/company`

The key Jimmo already holds finally becomes usable (Basic auth, server-side).

- `?q=<name>` → search, top 10: number, name, status, incorporated, address
  snippet.
- `?number=<n>` → profile (status, incorporation date, **registered office
  address**, SIC codes) + persons with significant control (names, kind) +
  officers (name, role, appointed) in one response.
- `?address=<text>&sic=<code>` → advanced search by registered office address,
  the studio-portfolio method from `contact-tracing-playbook.md` — and the fix
  for the stale-cache trap it warns about, because this is a real API call
  every time, not a summarised page.

Cache 7 days. Rate limit is generous (600 requests / 5 min on the public API);
a per-run ceiling of ~100 is still sensible.

### 3b. Rendered pages — `/api/enrich/render?url=`

The exhibitor-list fix. Headless Chromium renders the page and returns
`{ text, links: [{ text, href }] }`, text capped at 200 KB, `links` limited to
the page's main content where detectable. Exhibitor directories are lists of
links, so `links` is the part the scanner actually wants.

On Vercel: `playwright-core` + `@sparticuz/chromium`, on the Node runtime with
`maxDuration` raised (Pro allows it). If cold starts or the function size limit
make that miserable, the fallback is a tiny Railway worker with Playwright
proper and the panel proxying to it — decide by trying Vercel first, not by
guessing.

**This endpoint is a server-side request forgery vector and must be built as
if it were public.** Non-negotiable: `https` only; hostname must be on an
allow-list held in a table (`render_allowlist (host, added_by, note)`) with a
small admin UI or a script to add to it; resolve the hostname and refuse
private, loopback and link-local ranges *before* connecting; refuse redirects
off the allow-list; no cookies, no auth, a fixed innocuous user agent; 20 s
timeout. Seed the allow-list with the exhibitor-list domains in the exhibitions
ledger. Cache 24 h.

### 3c. Programmatic search — `/api/enrich/search?q=&site=`

Google's Programmable Search JSON API (`GOOGLE_CSE_ID`, `GOOGLE_CSE_KEY`),
optional `site=` restriction. Returns `[{ title, link, snippet }]`. This is the
"see us at stand" sweep as a query rather than a hand search, and it is also
how a scanner finds a person's public profile URL without a LinkedIn login:
`site=linkedin.com/in&q="marketing manager" "<company>"` returns links and
snippets, which is a search string made real — not an invented URL. 100 free
queries a day, about $5 per thousand after; the quota table caps it at a
number Jimmo sets. **Do not use the Bing Web Search API** — retired in 2025.

### 3d. Public tenders — `/api/enrich/tenders?q=&since=&buyer=`

Find a Tender (`/api/1.0/ocdsReleasePackages`) and Contracts Finder
(`/Published/Notices/OCDS/Search`), both free, both keyless, both OCDS. Return,
per notice: buyer name, notice title, description snippet, value, deadline,
notice URL, and — the reason this exists — **the notice's `contactPoint`:
name, email, telephone**, which public procurement law requires to be
published. This is the only source in this document that yields a *named
buyer* as a matter of routine. Cache 24 h; searches for "event", "décor",
"floristry", "exhibition stand", "styling", "hospitality" and a buyer name.

For the suppliers scanner this turns "GAP — no named procurement contact"
into a real name for every public-sector venue and body, and the
`planned procurement notice` type (Procurement Act 2023) gives forward
pipelines from the largest buyers.

### 3e. Email patterns — `/api/enrich/email-pattern?domain=` (later, paid)

Hunter.io domain search (`HUNTER_API_KEY`): the organisation's email format
and confidence, plus any *published* named addresses Hunter has seen with
their source URLs. Build it last, and build it with a hard rule in the
response: `{ pattern: "first.last", confidence: 0.9, verified: false }`. A
pattern is not a contact. The scanner may write `GAP — no named contact
published; domain email pattern first.last@x.com (unverified)` and nothing
stronger. If Aurelija later wants verified addresses at scale, that is a
separate decision about B2B data under UK GDPR's legitimate-interest basis,
taken out loud.

### 3f. The GAP-closing list — `/api/leads/approved-gaps?agent=&region=`

Read-class (`INGEST_READ_KEY`), returns approved leads whose `contact` still
starts with `GAP` (`isGap()` in `src/lib/leads.ts` already exists), with the
fields a scanner needs to have another go. A scanner works this list **first**,
before scanning for anything new — depth where Aurelija has already said it
matters. A lead it improves is re-submitted through the bridge with the same
`id`; the upsert refreshes `contact` and `role` and leaves her decision alone,
exactly as now.

---

## Stage 4 — the scanner side

Three prompt blocks replace A and B, plus one new rule that costs nothing:

- **Block A′** — write the JSON file to the inbox (Stage 1).
- **Block B′** — GET the digest with `?key=` (Stage 2).
- **Block C** — enrichment: work `/approved-gaps` first; use `/tenders` and
  `/company` before declaring a contact or address GAP; use `/render` for any
  exhibitor list the ledger marks unfetchable; use `/search` for the social
  sweep and for profile URLs. Over-quota or a 5xx means fall back to what the
  runtime can do alone, and say so in the run notes. The never-invent rule is
  unchanged and Block C must say so in as many words.
- **GAP with a next step.** Every `GAP — …` carries what a human should do
  next: "GAP — no named contact published; next: call the switchboard on
  020 … and ask for the exhibitions manager", or "next: LinkedIn search
  'head of events' + '<venue>'". A GAP that says what to do is a route, which
  is what Aurelija asked for.

The runbooks in the Claude project (`claude/agents/*-runbook.md`) get the
GAP-with-next-step rule and the GAP-closing pass immediately, because they need
no code. The Block A′/B′/C text goes in once the corresponding stage is live —
never before, or the scanner will spend a run failing against an endpoint that
does not exist and report it as a source problem.

---

## Order of work, and what is blocked on what

1. **Stage 1, the bridge.** Unblocks all seven scanners and retires the sheets.
   Everything else is nicer with it and nothing else depends on it.
2. **Stage 2.** A few lines in `ingest-auth.ts`; do it with Stage 1.
3. **3a Companies House and 3d tenders.** Free, keyless or key-in-hand, highest
   depth per hour of work. 3f alongside — it is a query.
4. **3c search.** Needs a Google Cloud project with the API enabled and a
   Programmable Search Engine created (search the whole web, not a site list).
5. **3b render.** The most infrastructure and the most security; also the
   single biggest exhibitor-list unlock. After the cheap ones prove the pattern.
6. **3e email patterns.** Paid, and only once Aurelija says the pattern line is
   useful to her.

Adjacent, already noted in the scanner briefs and worth doing before the
suppliers scanner runs in anger: `organisations.supplierUrl` (the portal link
has nowhere to live once a supplier lead is approved) and a `chaseBy` date on
leads (an exhibition lead is only worth acting on in a window).

---

## Things about this I think are a bad idea

**1. The render endpoint is the panel fetching arbitrary URLs on request.**
Without the allow-list and the private-range check it is an open proxy into
whatever network the function can see. Build the guard first and the renderer
second, and keep the allow-list in a table so adding a domain is a row, not a
deploy. If the allow-list ever feels like friction, that is the feature working.

**2. Keys in query strings.** Covered in Stage 2. The honest position is that
these keys were already in plain text in prompts; the URL adds log exposure,
not a new class of holder. Rotate on the trigger the prompt-changes doc names.

**3. Enrichment that writes.** It will be tempting to have `/company` update
`leads.entity` and `leads.address` directly, skipping the scanner. Don't. The
scanner is the only thing in the loop that reads the source and decides whether
the fact belongs to *this* lead; an endpoint matching on a company name will
attach the wrong Oasis Productions to the right lead and nobody will notice
until Aurelija writes to it.

**4. A pattern is not a contact.** 3e returns something that looks like an
email. The never-invent rule was written for exactly this, and the endpoint
must make the unverified status impossible to lose — in the response shape,
not in a comment.

**5. Two systems of record for one run.** While a scanner writes both a sheet
and an inbox file, the numbers will disagree the first time someone edits the
sheet by hand. Keep that overlap to one run per scanner, then stop the sheet.

**6. The cron cannot be told to stop, and neither can a scanner.** The
prompt-changes doc's point 4 stands. If a scanner starts writing rubbish, the
inbox fills with it every week and the puller will faithfully ingest it. A
`paused` flag per agent in the panel, checked by the puller before it ingests a
file, is cheap and belongs in Stage 1 — the file goes to `failed` with
`"paused"` as the error, and nothing is lost.
