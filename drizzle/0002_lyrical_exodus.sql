CREATE TYPE "public"."activity_kind" AS ENUM('email_sent', 'email_received', 'call', 'meeting', 'quote_sent', 'note');--> statement-breakpoint
CREATE TYPE "public"."feedback_reason" AS ENUM('wrong_location', 'wrong_sector', 'too_small', 'already_client', 'bad_timing', 'contact_unusable', 'other');--> statement-breakpoint
CREATE TYPE "public"."feedback_verdict" AS ENUM('useful', 'not_useful');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('open', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."organisation_relationship" AS ENUM('direct_client', 'venue_partner', 'referral_partner', 'agency_partner');--> statement-breakpoint
CREATE TYPE "public"."referral_potential" AS ENUM('high', 'medium', 'low', 'unknown');--> statement-breakpoint
CREATE TABLE "activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "activity_kind" NOT NULL,
	"occurred_at" date NOT NULL,
	"summary" text NOT NULL,
	"actor_id" uuid,
	"lead_id" uuid,
	"organisation_id" uuid,
	"contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "activities_has_link" CHECK ("activities"."lead_id" IS NOT NULL OR "activities"."organisation_id" IS NOT NULL OR "activities"."contact_id" IS NOT NULL),
	CONSTRAINT "activities_contact_implies_org" CHECK ("activities"."contact_id" IS NULL OR "activities"."organisation_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organisation_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"name" text,
	"job_title" text,
	"email" text,
	"phone" text,
	"gap" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_email_shape" CHECK ("contacts"."email" IS NULL OR "contacts"."email" LIKE '%@%')
);
--> statement-breakpoint
CREATE TABLE "follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"due_at" date NOT NULL,
	"note" text,
	"status" "follow_up_status" DEFAULT 'open' NOT NULL,
	"assignee_id" uuid,
	"completed_at" timestamp with time zone,
	"lead_id" uuid,
	"organisation_id" uuid,
	"contact_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "follow_ups_has_link" CHECK ("follow_ups"."lead_id" IS NOT NULL OR "follow_ups"."organisation_id" IS NOT NULL OR "follow_ups"."contact_id" IS NOT NULL),
	CONSTRAINT "follow_ups_contact_implies_org" CHECK ("follow_ups"."contact_id" IS NULL OR "follow_ups"."organisation_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "lead_feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"verdict" "feedback_verdict" NOT NULL,
	"reason" "feedback_reason",
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lead_feedback_reason_when_not_useful" CHECK ("lead_feedback"."verdict" <> 'not_useful' OR "lead_feedback"."reason" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "organisations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"region" "region" DEFAULT 'UK' NOT NULL,
	"dedupe_key" text NOT NULL,
	"name" text NOT NULL,
	"sector" text,
	"tier" integer,
	"relationship" "organisation_relationship",
	"website" text,
	"location" text,
	"referral_potential" "referral_potential" DEFAULT 'unknown' NOT NULL,
	"estimated_value_pence" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organisations_tier_range" CHECK ("organisations"."tier" IS NULL OR "organisations"."tier" BETWEEN 1 AND 3)
);
--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "organisation_id" uuid;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_people_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activities" ADD CONSTRAINT "activities_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_assignee_id_people_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_feedback" ADD CONSTRAINT "lead_feedback_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_feedback" ADD CONSTRAINT "lead_feedback_actor_id_people_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activities_lead_idx" ON "activities" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "activities_org_idx" ON "activities" USING btree ("organisation_id");--> statement-breakpoint
CREATE INDEX "activities_contact_idx" ON "activities" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "activities_occurred_idx" ON "activities" USING btree ("occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contacts_org_dedupe_idx" ON "contacts" USING btree ("organisation_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "follow_ups_status_due_idx" ON "follow_ups" USING btree ("status","due_at");--> statement-breakpoint
CREATE INDEX "follow_ups_assignee_idx" ON "follow_ups" USING btree ("assignee_id");--> statement-breakpoint
CREATE INDEX "follow_ups_lead_idx" ON "follow_ups" USING btree ("lead_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lead_feedback_lead_actor_idx" ON "lead_feedback" USING btree ("lead_id","actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organisations_region_dedupe_idx" ON "organisations" USING btree ("region","dedupe_key");--> statement-breakpoint
CREATE INDEX "organisations_name_idx" ON "organisations" USING btree ("name");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organisation_id_organisations_id_fk" FOREIGN KEY ("organisation_id") REFERENCES "public"."organisations"("id") ON DELETE set null ON UPDATE no action;