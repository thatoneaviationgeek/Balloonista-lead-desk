CREATE TYPE "public"."ingest_file_status" AS ENUM('processing', 'ok', 'failed');--> statement-breakpoint
CREATE TABLE "agent_settings" (
	"agent" text NOT NULL,
	"region" "region" NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_settings_agent_region_pk" PRIMARY KEY("agent","region")
);
--> statement-breakpoint
CREATE TABLE "ingest_files" (
	"drive_file_id" text PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"status" "ingest_file_status" DEFAULT 'processing' NOT NULL,
	"run_id" uuid,
	"error" text,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ingest_files" ADD CONSTRAINT "ingest_files_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ingest_files_status_idx" ON "ingest_files" USING btree ("status");