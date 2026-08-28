# Balloonista Lead Desk

A static, read-only dashboard of every lead the Balloonista scanners have found —
retail and hospitality openings, film and TV productions in pre-production, and
galas and balls. Built to be shared with the whole team: no login to Claude, no
Google account, nothing to install.

## What's in here

| File | What it does |
|---|---|
| `index.html` | The dashboard. Plain HTML/CSS/JS, no build step, no framework. |
| `leads.json` | The data. **This is the only file you change to refresh the leads.** |
| `vercel.json` | Sends `noindex` headers and stops `leads.json` being cached. |
| `middleware.js` | Optional password gate. Delete it if you don't want one. |

## Deploy

From this folder:

```bash
npx vercel          # first deploy, follow the prompts
npx vercel --prod   # promote to the production URL
```

Framework preset: **Other**. There is no build command and no output directory —
it is static files.

Or push the folder to a Git repo and import it in the Vercel dashboard.

## Password protection (optional)

`middleware.js` adds HTTP basic auth. In Vercel go to
**Project → Settings → Environment Variables** and add:

- `SITE_PASSWORD` — required to switch the gate on. Leave it unset and the site stays open.
- `SITE_USER` — optional, defaults to `balloonista`.

Redeploy after adding them. If Edge Middleware isn't available on your plan,
delete `middleware.js` and use Vercel's own Deployment Protection instead, or
just keep the URL unlisted — `vercel.json` already sends `noindex` so search
engines won't pick it up.

## Refreshing the leads

The scanners write to Google Sheets in the "Balloonista Lead Agents" Drive folder.
To update this site, replace `leads.json` and redeploy. Ask Claude for a fresh
`leads.json` and it will regenerate it from the current sheets.

### Shape of the data

```json
{
  "updated": "2026-08-28",
  "leads": [
    {
      "id": "f-hkyf",
      "agent": "Retail | Film | Events",
      "title": "How to Kill Your Family",
      "fit": "High | Medium | Low",
      "what": "One paragraph on what is happening and when.",
      "where": "London · Netflix / Sid Gentle Films",
      "entity": "The UK company that would sign the contract, or 'Not traced'",
      "address": "Its registered office — where to write",
      "contact": "Named person, or 'GAP — no contact found'",
      "role": "Their job title and how to reach them",
      "src": "https://source-url",
      "status": "New | Approved | Rejected"
    }
  ]
}
```

`status` is optional and defaults to `New`. Anything marked Approved or Rejected
is dimmed and filtered out of the default "To review" view.

## Local preview

Opening `index.html` straight off disk won't work — the browser blocks it from
reading `leads.json`. Serve the folder instead:

```bash
npx serve
```

## Where this is going

This version is read-only on purpose: approvals live in the Google Sheets (and in
the Claude dashboard), because that is what the scanners read back each week.
The next step is a real backend — Postgres for the leads, the scanners as jobs,
and approve/reject writing straight to the database. When that exists, only one
line changes here: the `fetch('./leads.json')` call points at the API instead.

## Honest limits

- The data is a snapshot from whenever `leads.json` was last replaced, not live.
- Contacts marked GAP could not be verified. Nothing is invented or guessed.
- Nothing on this site contacts anyone. It is a list to read and act on by hand.
