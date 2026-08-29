# Balloonista Control Panel

The internal panel for Balloonista: leads today, booked-in work and staff tasks next.
Next.js 16 (App Router) + Postgres (Neon) + Google sign-in, deployed on Vercel.

> **Branch note.** This is the `v2` branch. `main` still holds the original static
> lead desk that is live on Vercel today, and nothing here touches it. Cut the
> production domain over only once this branch is at parity.

---

## Setting it up

Everything below runs in `C:\AI Agents\balloonista-lead-desk`.

### 1. Install

```bash
npm install
```

### 2. Environment

Copy `.env.example` to a new file called `.env.local` **in the repo root** and fill it in:

| Variable | Where it comes from |
|---|---|
| `DATABASE_URL` | Neon → your project → Connection string → **pooled** |
| `AUTH_SECRET` | run `npx auth secret`, or `openssl rand -base64 32` |
| `AUTH_GOOGLE_ID` / `AUTH_GOOGLE_SECRET` | Google Cloud console → APIs & Services → Credentials → OAuth client ID (Web application) |
| `ALLOWED_EMAIL_DOMAIN` | your Workspace domain, e.g. `balloonista.co.uk`. Blank = only people already in the `people` table can sign in |
| `INGEST_KEY` | `openssl rand -hex 24` — the shared secret the scanners post with |

Authorised redirect URIs on the Google OAuth client:

```
http://localhost:3000/api/auth/callback/google
https://<your-vercel-domain>/api/auth/callback/google
```

### 3. Create the tables

```bash
npm run db:migrate     # applies drizzle/0000_init.sql
```

`npm run db:studio` opens a browser table browser if you want to poke about.

### 4. Load the existing leads

```bash
npm run import:leads
```

Reads `leads-uk.json` and `leads-dubai.json` from the repo root and loads both
markets. Safe to run again — leads are matched on region + id, facts are
refreshed, and **a status already set in the database is never overwritten**.

### 5. Put yourselves on the allow-list

```bash
npm run people:add -- you@balloonista.co.uk owner "Jimmo"
npm run people:add -- aurelija@balloonista.co.uk owner "Aurelija"
npm run people:list
```

Roles: `owner`, `staff`, `viewer`. Viewers see leads but cannot approve or reject.

### 6. Run it

```bash
npm run dev          # http://localhost:3000
```

---

## What's in here

```
src/
  auth.config.ts        edge-safe auth config — this is what middleware loads
  auth.ts               full auth: Google sign-in, allow-list check, roles
  db/schema.ts          every table (leads, people, audit, runs, jobs, tasks)
  db/index.ts           lazy Neon connection
  lib/leads.ts          shared lead shapes, de-dupe key, labels
  app/leads/            the lead desk — server page + client filtering
  app/signin/           Google sign-in
  app/api/leads/        list, status change, scanner ingest
  components/           app bar, lead card
  scripts/              import-leads, seed-people
drizzle/0000_init.sql   the migration
legacy/                 the original static site, kept for reference
```

## The scanners

Instead of writing a Google Sheet and hand-building a JSON file, a scanner now
POSTs its results straight in:

```bash
curl -X POST https://<domain>/api/leads/ingest \
  -H "x-ingest-key: $INGEST_KEY" \
  -H "content-type: application/json" \
  -d '{
        "region": "UK",
        "agent": "Film",
        "leads": [
          { "id": "f-xyz", "agent": "Film", "title": "…", "fit": "High",
            "what": "…", "where": "…", "entity": "…", "address": "…",
            "contact": "…", "role": "…", "src": "https://…" }
        ]
      }'
```

Every call writes a row to `agent_runs` with what it found, how much was new and
how much was already known — that table is what the agent control screen will
read in Phase 4. `/api/leads/ingest` is the only route that is not behind the
Google login; it is protected by `INGEST_KEY` instead.

Keep the scanners writing to Sheets in parallel for a fortnight or so. If
anything here misbehaves, the old path is still there.

## Accessibility

Colour pairs are checked against WCAG 2.2 AA: ≥4.5:1 for text, ≥3:1 for UI
component boundaries, in both light and dark. The one change from v1 is
`--rule-2` — the border on chips, buttons and inputs — which was 1.53:1 in light
and 2.18:1 in dark and now passes at 3.47:1 and 3.92:1.

## Deploying

Vercel picks the framework up automatically (Next.js, no settings to change).
Add every variable from `.env.example` under **Project → Settings → Environment
Variables**, plus `AUTH_URL` set to the production URL. Deploy the `v2` branch to
a preview URL first; promote it to production only once the leads are in and
sign-in works.
