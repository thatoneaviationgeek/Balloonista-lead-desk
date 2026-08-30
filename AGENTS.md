<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:balloonista -->

# Balloonista Control Panel — house rules

**What this is.** The internal panel for Balloonista (balloon décor: Central London
installs, UK mainland courier, plus a Dubai operation). Phase 1 is the lead desk on
a real backend. Phases after: jobs board fed by Google Calendar and Gmail, staff
tasks, agent control. Read `README.md` first.

**Stack.** Next.js 16 App Router · TypeScript · Postgres on Neon via Drizzle ·
Auth.js v5 with Google · Tailwind v4 for layout, hand-written CSS in
`src/app/globals.css` for the lead desk look. No component library — the design
tokens are ported from the v1 static site and should not be redesigned casually.

**Rules that matter here:**

- **Never invent lead data.** Contacts that could not be verified read `GAP — …`.
  Do not fabricate names, emails or addresses anywhere in this codebase, including
  fixtures and seeds.
- **Nothing in this app contacts anyone.** No automated outreach, ever. Aurelija
  approves each lead by hand and makes contact herself. Do not add send/email
  features to the leads flow.
- **A scanner rerun must never overwrite a status.** Approve/reject is a human
  decision; ingest refreshes facts only. There is a test for this in the upsert.
- **British English** in all copy, comments and commit messages.
- **WCAG 2.2 AA.** Any colour pair you add: ≥4.5:1 for text, ≥3:1 for UI component
  boundaries, checked in both light and dark.
- **`legacy/` is the old static site.** Reference only; do not edit or import it.

**Current work:** Phase 1 (lead desk on Postgres) is done. Next is
`docs/phase-2a-pipeline.md` — contacts, activity logging, follow-ups and lead
feedback, written from Aurelija's own feedback. After that,
`docs/phase-2-jobs-board.md` for jobs and calendar sync, whose Stage 0 schema
is already done.

**Before committing:** `npm run typecheck && npm run lint && npm run build`.

**Migrations:** edit `src/db/schema.ts`, then `npm run db:generate`, then
`npm run db:migrate`. Do not hand-edit files in `drizzle/`.
<!-- END:balloonista -->
