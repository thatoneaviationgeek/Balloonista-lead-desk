CREATE TYPE "public"."fit" AS ENUM('High', 'Medium', 'Low');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('enquiry', 'quoted', 'confirmed', 'delivered', 'invoiced', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_type" AS ENUM('install', 'courier', 'set_dec', 'other');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('New', 'Approved', 'Rejected');--> statement-breakpoint
CREATE TYPE "public"."person_role" AS ENUM('owner', 'staff', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."region" AS ENUM('UK', 'Dubai');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('running', 'ok', 'failed');--> statement-breakpoint
CREATE TYPE "public"."task_priority" AS ENUM('low', 'normal', 'high');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'doing', 'done', 'blocked');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent" text NOT NULL,
	"region" "region" NOT NULL,
	"status" "run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"leads_found" integer DEFAULT 0 NOT NULL,
	"leads_new" integer DEFAULT 0 NOT NULL,
	"leads_duplicate" integer DEFAULT 0 NOT NULL,
	"error" text,
	"meta" jsonb
);
--> statement-breakpoint
CREATE TABLE "google_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"email" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"scopes" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region" "region" DEFAULT 'UK' NOT NULL,
	"title" text NOT NULL,
	"client_name" text,
	"venue" text,
	"type" "job_type" DEFAULT 'other' NOT NULL,
	"status" "job_status" DEFAULT 'enquiry' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"value_pence" integer,
	"owner_id" uuid,
	"lead_id" uuid,
	"calendar_event_id" text,
	"calendar_id" text,
	"gmail_thread_id" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"from_status" "lead_status",
	"to_status" "lead_status" NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region" "region" NOT NULL,
	"source_id" text,
	"dedupe_key" text NOT NULL,
	"agent" text NOT NULL,
	"title" text NOT NULL,
	"fit" "fit" DEFAULT 'Medium' NOT NULL,
	"what" text DEFAULT '' NOT NULL,
	"where_text" text,
	"entity" text,
	"address" text,
	"contact" text,
	"role" text,
	"src" text,
	"status" "lead_status" DEFAULT 'New' NOT NULL,
	"status_changed_at" timestamp with time zone,
	"status_changed_by" uuid,
	"notes" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" "person_role" DEFAULT 'staff' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"image" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"job_id" uuid,
	"assignee_id" uuid,
	"due_at" timestamp with time zone,
	"priority" "task_priority" DEFAULT 'normal' NOT NULL,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "google_accounts" ADD CONSTRAINT "google_accounts_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_owner_id_people_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_events" ADD CONSTRAINT "lead_events_actor_id_people_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_status_changed_by_people_id_fk" FOREIGN KEY ("status_changed_by") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_people_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_started_idx" ON "agent_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "google_accounts_person_idx" ON "google_accounts" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_calendar_event_idx" ON "jobs" USING btree ("calendar_event_id");--> statement-breakpoint
CREATE INDEX "jobs_starts_idx" ON "jobs" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "lead_events_lead_idx" ON "lead_events" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_region_dedupe_idx" ON "leads" USING btree ("region","dedupe_key");--> statement-breakpoint
CREATE INDEX "leads_region_status_idx" ON "leads" USING btree ("region","status");--> statement-breakpoint
CREATE INDEX "leads_agent_idx" ON "leads" USING btree ("agent");--> statement-breakpoint
CREATE UNIQUE INDEX "people_email_idx" ON "people" USING btree ("email");--> statement-breakpoint
CREATE INDEX "tasks_assignee_status_idx" ON "tasks" USING btree ("assignee_id","status");