import {
  boolean,
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
export const taskStatusEnum = pgEnum("task_status", ["todo", "doing", "done", "blocked"]);
export const taskPriorityEnum = pgEnum("task_priority", ["low", "normal", "high"]);

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
    gmailThreadId: text("gmail_thread_id"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("jobs_calendar_event_idx").on(t.calendarEventId),
    index("jobs_starts_idx").on(t.startsAt),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "cascade" }),
    assigneeId: uuid("assignee_id").references(() => people.id, { onDelete: "set null" }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    priority: taskPriorityEnum("priority").notNull().default("normal"),
    status: taskStatusEnum("status").notNull().default("todo"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("tasks_assignee_status_idx").on(t.assigneeId, t.status)],
);

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

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
export type Person = typeof people.$inferSelect;
