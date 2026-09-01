CREATE TYPE "public"."org_contact_status" AS ENUM('not_contacted', 'initial_email_sent', 'have_a_contact');--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "import_batch" text;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "contact_status" "org_contact_status" DEFAULT 'not_contacted' NOT NULL;--> statement-breakpoint
ALTER TABLE "organisations" ADD COLUMN "import_batch" text;--> statement-breakpoint
CREATE INDEX "organisations_import_batch_idx" ON "organisations" USING btree ("import_batch");