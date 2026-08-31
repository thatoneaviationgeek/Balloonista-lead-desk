import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ enums */

export const regionEnum = pgEnum("region", ["UK", "Dubai"]);
export const fitEnum = pgEnum("fit", ["High", "Medium", "Low"]);
export const leadStatusEnum = pgEnum("lead_status", ["New", "Approved", "Rejected"]);
export const personRoleEnum = pgEnum("person_role", ["owner", "staff", "viewer"]);
export const runStatusEnum = pgEnum("run_status", ["running", "ok", "failed"]);
export const jobStatusEnum = pgEnum("job_status", [
  "enquiry",
  "quoted",
  "confirmed",
  "delivered",
  "invoiced",
  "cancelled",
]);
export const jobTypeEnum = pgEnum("job_type", ["install", "courier", "set_dec", "other"]);
export const jobEventActionEnum = pgEnum("job_event_action", [
  "status",
  "assignment",
  "dismissal",
  "restored",
  "note",
]);
export const taskStatusEnum = pgEnum("task_status", ["todo", "doing", "done", "blocked"]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "normal", "high"]);

/* ------------------------------------------------ phase 2A: the pipeline   */

export const organisationRelationshipEnum = pgEnum("organisation_relationship", [
  "direct_client",
  "venue_partner",
  "referral_partner",
  "agency_partner",
]);
/* `unknown` rather than NULL: her spreadsheet's leftover `Select` default means
   "not filled in", and one way of saying that is enough. */
export const referralPotentialEnum = pgEnum("referral_potential", [
  "high",
  "medium",
  "low",
  "unknown",
]);
export const activityKindEnum = pgEnum("activity_kind", [
  "email_sent",
  "email_received",
  "call",
  "meeting",
  "quote_sent",
  "note",
]);
export const followUpStatusEnum = pgEnum("follow_up_status", ["open", "done", "cancelled"]);
export const feedbackVerdictEnum = pgEnum("feedback_verdict", ["useful", "not_useful"]);
/* Fixed on purpose. Free text alone drifts to "no" and "not right", which
   cannot be aggregated into anything a scanner prompt can use. */
export const feedbackReasonEnum = pgEnum("feedback_reason", [
  "wrong_location",
  "wrong_sector",
  "too_small",
  "already_client",
  "bad_timing",
  "contact_unusable",
  "other",
]);

/* ----------------------------------------------------------------- people */
/* Doubles as the login allow-list: no row, no access. */

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    name: text("name"),
    role: personRoleEnum("role").notNull().default("staff"),
    active: boolean("active").notNull().default(true),
    image: text("image"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("people_email_idx").on(t.email)],
);

/* ------------------------------------------------------------------ leads */

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    region: regionEnum("region").notNull(),
    /* the id the scanner gave it, e.g. "f-hkyf" — kept so a rerun matches up */
    sourceId: text("source_id"),
    /* stable key for de-duplication within a region */
    dedupeKey: text("dedupe_key").notNull(),

    agent: text("agent").notNull(),
    title: text("title").notNull(),
    fit: fitEnum("fit").notNull().default("Medium"),
    what: text("what").notNull().default(""),
    whereText: text("where_text"),
    entity: text("entity"),
    address: text("address"),
    contact: text("contact"),
    role: text("role"),
    src: text("src"),

    /* Set by hand when a scanner lead turns out to belong to an account she is
       already working. This is a decision, not a fact: it must never appear in
       the `set` list of the ingest upsert, or a rerun will silently unlink every
       account she attached. Exactly the same rule as `status` below. */
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "set null",
    }),

    status: leadStatusEnum("status").notNull().default("New"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    statusChangedBy: uuid("status_changed_by").references(() => people.id, {
      onDelete: "set null",
    }),
    notes: text("notes"),

    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("leads_region_dedupe_idx").on(t.region, t.dedupeKey),
    index("leads_region_status_idx").on(t.region, t.status),
    index("leads_agent_idx").on(t.agent),
  ],
);

/* Audit trail: every status change, who and when. */
export const leadEvents = pgTable(
  "lead_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => people.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    fromStatus: leadStatusEnum("from_status"),
    toStatus: leadStatusEnum("to_status").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_events_lead_idx").on(t.leadId)],
);

/* ------------------------------------------------------------- agent runs */

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agent: text("agent").notNull(),
    region: regionEnum("region").notNull(),
    status: runStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    leadsFound: integer("leads_found").notNull().default(0),
    leadsNew: integer("leads_new").notNull().default(0),
    leadsDuplicate: integer("leads_duplicate").notNull().default(0),
    error: text("error"),
    meta: jsonb("meta"),
  },
  (t) => [index("agent_runs_started_idx").on(t.startedAt)],
);

/* ------------------------------------------- phase 2: jobs and tasks       */
/* Defined now so the migration is one step, not two. Nothing writes to them  */
/* until the jobs board is built.                                             */

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    region: regionEnum("region").notNull().default("UK"),
    title: text("title").notNull(),
    clientName: text("client_name"),
    venue: text("venue"),
    type: jobTypeEnum("type").notNull().default("other"),
    status: jobStatusEnum("status").notNull().default("enquiry"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    valuePence: integer("value_pence"),
    ownerId: uuid("owner_id").references(() => people.id, { onDelete: "set null" }),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "set null" }),
    calendarEventId: text("calendar_event_id"),
    calendarId: text("calendar_id"),
    /* Google's own `updated` timestamp for the event. Storing it does nothing on
       its own: the Stage 2 upsert has to actually compare it — a `setWhere` on
       the conflict clause, so the write only lands when the incoming payload is
       newer than the row already held. Without that comparison a late, stale
       payload still overwrites a newer one, which is the precise failure this
       column exists to prevent.

       The column is nullable — a manually-created job has never come from the
       calendar and holds NULL here — so that comparison needs an explicit
       IS NULL arm, written out in full:

         jobs.source_updated_at IS NULL
           OR excluded.source_updated_at > jobs.source_updated_at

       A bare `>` against NULL evaluates to NULL rather than true, so the row
       would be skipped in silence and a manually-created job would never pick
       up its calendar link. */
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    gmailThreadId: text("gmail_thread_id"),
    notes: text("notes"),

    /* A shared calendar carries holidays, meetings and personal entries as well
       as work. Rather than guess with keyword rules, the sync imports everything
       and a person dismisses what is not a job. Dismissal is a panel-owned
       decision and a sync must never clear it — the same rule that stops a
       scanner rerun from overwriting an approved lead. */
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    dismissedBy: uuid("dismissed_by").references(() => people.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("jobs_calendar_event_idx").on(t.calendarEventId),
    index("jobs_starts_idx").on(t.startsAt),
  ],
);

/* Audit trail for jobs, mirroring `lead_events`. Who reassigned a job, and when,
   is the question asked after something has gone wrong — and it cannot be
   backfilled afterwards, so the rows have to start accumulating from the first
   change rather than from whenever the board UI lands.

   Unlike `lead_events`, not every entry here is a status transition: a
   reassignment and a dismissal both change nothing about `status`. `action` is
   the discriminator, and the from/to pairs are filled in only where they apply —
   `status` populates the status pair, `assignment` the owner pair, `dismissal`
   and `restored` neither, `note` neither. */
export const jobEvents = pgTable(
  "job_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => people.id, { onDelete: "set null" }),
    actorEmail: text("actor_email"),
    action: jobEventActionEnum("action").notNull(),
    fromStatus: jobStatusEnum("from_status"),
    toStatus: jobStatusEnum("to_status"),
    fromOwnerId: uuid("from_owner_id").references(() => people.id, { onDelete: "set null" }),
    toOwnerId: uuid("to_owner_id").references(() => people.id, { onDelete: "set null" }),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("job_events_job_idx").on(t.jobId)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    assigneeId: uuid("assignee_id").references(() => people.id, { onDelete: "set null" }),
    /* A day, not an instant — the same reasoning as `follow_ups.dueAt`. "Due
       Thursday" has no time of day, and a timestamp invites an off-by-one every
       time it crosses BST. Changed while `tasks` was still empty; once the jobs
       board writes rows this would need a data migration rather than a type
       change. */
    dueAt: date("due_at", { mode: "string" }),
    priority: taskPriorityEnum("priority").notNull().default("normal"),
    status: taskStatusEnum("status").notNull().default("todo"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tasks_assignee_status_idx").on(t.assigneeId, t.status)],
);

/* Incremental sync bookkeeping, one row per calendar. `calendarId` is the key
   because Google issues sync tokens per calendar and a token is only meaningful
   against the calendar that produced it. A null `syncToken` means the next run
   must fall back to a full sync — which is also how a 410 Gone is recorded:
   clear the token rather than storing a flag. */
export const calendarSyncState = pgTable("calendar_sync_state", {
  calendarId: text("calendar_id").primaryKey(),
  syncToken: text("sync_token"),
  lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
  lastError: text("last_error"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* Google OAuth tokens, one row per connected person. Phase 2. */
export const googleAccounts = pgTable(
  "google_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    scopes: text("scopes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("google_accounts_person_idx").on(t.personId)],
);

/* ---------------------------------------------------------- organisations */
/* The relationships she works over months and years — Harrods, Claridge's,
   Pinewood. Distinct from `leads`, which holds the one-off moments the scanners
   find. Linking the two is the point; merging them would damage both. */

export const organisations = pgTable(
  "organisations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    region: regionEnum("region").notNull().default("UK"),
    /* Stable key for de-duplication, derived from the normalised name. Her 57
       rows will be imported more than once before the mapping is right, and
       without this a second run doubles the list. Mirrors `leads.dedupeKey`. */
    dedupeKey: text("dedupe_key").notNull(),

    name: text("name").notNull(),
    sector: text("sector"),
    tier: integer("tier"),
    relationship: organisationRelationshipEnum("relationship"),
    website: text("website"),
    location: text("location"),
    referralPotential: referralPotentialEnum("referral_potential").notNull().default("unknown"),
    estimatedValuePence: integer("estimated_value_pence"),
    /* Some of these run to several paragraphs of genuine research. Keep whole. */
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("organisations_region_dedupe_idx").on(t.region, t.dedupeKey),
    index("organisations_name_idx").on(t.name),
    check("organisations_tier_range", sql`${t.tier} IS NULL OR ${t.tier} BETWEEN 1 AND 3`),
  ],
);

/* -------------------------------------------------------------- contacts */

export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organisationId: uuid("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    /* Normalised email where there is one, normalised name otherwise. Email
       first because one organisation often has several named people — her sheet
       has two at Fortnum's — and a name alone is the weaker key. */
    dedupeKey: text("dedupe_key").notNull(),

    name: text("name"),
    jobTitle: text("job_title"),
    /* Either a real address or NULL — never prose. Her sheet writes "Find her on
       LinkedIn" into the email column; that is a stated gap, and it belongs in
       `gap` below so this column stays trustworthy. The CHECK is deliberately
       loose: it catches prose without pretending to validate an address. */
    email: text("email"),
    phone: text("phone"),
    /* The honest no-contact-found note, same convention as `GAP — …` on a lead.
       It must survive as a stated gap, not be scrubbed to a blank. */
    gap: text("gap"),
    notes: text("notes"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contacts_org_dedupe_idx").on(t.organisationId, t.dedupeKey),
    check("contacts_email_shape", sql`${t.email} IS NULL OR ${t.email} LIKE '%@%'`),
  ],
);

/* ------------------------------------------------------------ activities */
/* What a person did. Nothing in this application contacts anyone: these rows
   record that Aurelija made contact herself, they do not send anything. */

export const activities = pgTable(
  "activities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: activityKindEnum("kind").notNull(),
    /* A day, not an instant. "I emailed Emma on 28 August" has no time of day,
       and a timestamp here invites an off-by-one every time it crosses BST.
       Read as a string so it never becomes a JS Date at the boundary. */
    occurredAt: date("occurred_at", { mode: "string" }).notNull(),
    summary: text("summary").notNull(),
    actorId: uuid("actor_id").references(() => people.id, { onDelete: "set null" }),

    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    /* Denormalised on purpose, and set once at write time from the contact's
       organisation. DO NOT backfill or "correct" this later: if Emma moves from
       Chain of Hope to another charity, the August email must still read as
       having gone to Emma at Chain of Hope. This column is history, not a
       duplicate of the contact's current employer. */
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "cascade",
    }),
    /* Nulled rather than cascaded when a contact is hard-deleted, so the
       business record survives without the personal data. The second CHECK
       below is what makes that always possible. */
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("activities_lead_idx").on(t.leadId),
    index("activities_org_idx").on(t.organisationId),
    index("activities_contact_idx").on(t.contactId),
    index("activities_occurred_idx").on(t.occurredAt),
    check(
      "activities_has_link",
      sql`${t.leadId} IS NOT NULL OR ${t.organisationId} IS NOT NULL OR ${t.contactId} IS NOT NULL`,
    ),
    /* This constraint exists so that `ON DELETE SET NULL` on `contact_id` can
       always succeed, and that is the only reason it exists — it is not
       reconstructable from the rule it states.

       Hard-deleting a contact nulls this row's `contact_id`. If the contact had
       been the row's only link, `activities_has_link` above would then be
       violated, and Postgres would refuse the delete: a deletion request would
       come back as an unexplained foreign-key error with no obvious cause.
       Requiring an organisation alongside every contact guarantees a surviving
       link, so the delete always goes through — the business record stays, and
       only the personal data goes. Remove this and contact deletion breaks in a
       way that will take an afternoon to diagnose. */
    check(
      "activities_contact_implies_org",
      sql`${t.contactId} IS NULL OR ${t.organisationId} IS NOT NULL`,
    ),
  ],
);

/* ------------------------------------------------------------- follow_ups */

export const followUps = pgTable(
  "follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /* A day, for the same reason as `activities.occurredAt`. */
    dueAt: date("due_at", { mode: "string" }).notNull(),
    note: text("note"),
    status: followUpStatusEnum("status").notNull().default("open"),
    assigneeId: uuid("assignee_id").references(() => people.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),

    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    organisationId: uuid("organisation_id").references(() => organisations.id, {
      onDelete: "cascade",
    }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* The Due view reads open rows in date order; this is its index. */
    index("follow_ups_status_due_idx").on(t.status, t.dueAt),
    index("follow_ups_assignee_idx").on(t.assigneeId),
    index("follow_ups_lead_idx").on(t.leadId),
    check(
      "follow_ups_has_link",
      sql`${t.leadId} IS NOT NULL OR ${t.organisationId} IS NOT NULL OR ${t.contactId} IS NOT NULL`,
    ),
    /* Same reasoning as `activities_contact_implies_org` — see the comment
       there. It is what lets a contact be hard-deleted without the SET NULL
       tripping `follow_ups_has_link` and blocking the deletion. */
    check(
      "follow_ups_contact_implies_org",
      sql`${t.contactId} IS NULL OR ${t.organisationId} IS NOT NULL`,
    ),
  ],
);

/* ---------------------------------------------------------- lead_feedback */
/* Her verdict on whether a scanner lead was worth having. One row per lead per
   person and updatable — she is allowed to change her mind. */

export const leadFeedback = pgTable(
  "lead_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leadId: uuid("lead_id")
      .notNull()
      .references(() => leads.id, { onDelete: "cascade" }),
    /* Not nullable: the unique index below is what makes "one per person"
       enforceable rather than aspirational, and a null actor would defeat it. */
    actorId: uuid("actor_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),

    verdict: feedbackVerdictEnum("verdict").notNull(),
    reason: feedbackReasonEnum("reason"),
    note: text("note"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("lead_feedback_lead_actor_idx").on(t.leadId, t.actorId),
    /* Not useful has to say why, so the digest can aggregate it. Useful never
       asks for anything — that is the answer we want more of. */
    check(
      "lead_feedback_reason_when_not_useful",
      sql`${t.verdict} <> 'not_useful' OR ${t.reason} IS NOT NULL`,
    ),
  ],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Person = typeof people.$inferSelect;
