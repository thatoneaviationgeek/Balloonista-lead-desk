CREATE TYPE "public"."organisation_event_action" AS ENUM('stage', 'note');--> statement-breakpoint
CREATE TABLE "organisation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"actor_id" uuid,
	"actor_email" text,
	"action" "organisation_event_action" NOT NULL,
	"from_stage" "org_contact_status",
	"to_stage" "org_contact_status",
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organisation_events" ADD CONSTRAINT "organisation_events_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organisation_events" ADD CONSTRAINT "organisation_events_actor_id_people_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "organisation_events_org_idx" ON "organisation_events" USING btree ("organisation_id");