CREATE TABLE "outreach" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source_key" text NOT NULL,
	"plan_id" text,
	"sponsor_match_id" text,
	"kind" text NOT NULL,
	"context" text NOT NULL,
	"recipient" text NOT NULL,
	"recipient_email" text,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"stage" text DEFAULT 'drafted' NOT NULL,
	"owner_id" text,
	"sent_by" text,
	"sent_at" timestamp with time zone,
	"content_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"moved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outreach_stage_check" CHECK ("outreach"."stage" in ('drafted', 'sent', 'replied', 'negotiating', 'booked', 'lost')),
	CONSTRAINT "outreach_kind_check" CHECK ("outreach"."kind" in ('partner', 'venue', 'sponsor'))
);
--> statement-breakpoint
CREATE TABLE "outreach_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"outreach_id" text NOT NULL,
	"actor_id" text,
	"from_stage" text,
	"to_stage" text NOT NULL,
	"sent" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_sponsor_match_id_sponsor_matches_id_fk" FOREIGN KEY ("sponsor_match_id") REFERENCES "public"."sponsor_matches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_outreach_id_outreach_id_fk" FOREIGN KEY ("outreach_id") REFERENCES "public"."outreach"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_events" ADD CONSTRAINT "outreach_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "outreach_source_idx" ON "outreach" USING btree ("workspace_id","source_key");--> statement-breakpoint
CREATE INDEX "outreach_workspace_idx" ON "outreach" USING btree ("workspace_id","stage");--> statement-breakpoint
CREATE INDEX "outreach_events_card_idx" ON "outreach_events" USING btree ("workspace_id","outreach_id","at");