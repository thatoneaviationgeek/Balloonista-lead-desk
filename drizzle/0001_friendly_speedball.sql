CREATE TYPE "public"."job_event_action" AS ENUM('status', 'assignment', 'dismissal', 'restored', 'note');--> statement-breakpoint
CREATE TABLE "calendar_sync_state" (
	"calendar_id" text PRIMARY KEY NOT NULL,
	"sync_token" text,
	"last_full_sync_at" timestamp with time zone,
	"last_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"action" "job_event_action" NOT NULL,
	"from_status" "job_status",
	"to_status" "job_status",
	"from_owner_id" uuid,
	"to_owner_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "dismissed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "dismissed_by" uuid;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_actor_id_people_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_from_owner_id_people_id_fk" FOREIGN KEY ("from_owner_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_to_owner_id_people_id_fk" FOREIGN KEY ("to_owner_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" USING btree ("job_id");--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_dismissed_by_people_id_fk" FOREIGN KEY ("dismissed_by") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;