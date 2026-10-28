ALTER TABLE "comments" DROP CONSTRAINT "comments_target_check";--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "plan_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "digest_subscriptions" ADD COLUMN "reminders_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "outreach_id" text;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "contact_name" text;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "due_date" text;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "outreach" ADD COLUMN "reminded_for" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_outreach_id_outreach_id_fk" FOREIGN KEY ("outreach_id") REFERENCES "public"."outreach"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_target_idx" ON "comments" USING btree ("workspace_id","target_type","target_id");--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_target_check" CHECK ("comments"."target_type" in ('plan', 'partner', 'city', 'venue', 'sponsor', 'outreach'));