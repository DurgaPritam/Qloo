CREATE TABLE "entity_profiles" (
	"key" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"mock" boolean NOT NULL,
	"profile" jsonb NOT NULL,
	"refreshed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text,
	"status" text NOT NULL,
	"payload" jsonb,
	"qloo_calls" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	CONSTRAINT "job_runs_status_check" CHECK ("job_runs"."status" in ('queued', 'running', 'done', 'failed', 'skipped_budget'))
);
--> statement-breakpoint
CREATE TABLE "roster_acts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"roster_id" text NOT NULL,
	"qloo_entity_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"entity" jsonb NOT NULL,
	"home_city" text,
	"added_by" text,
	"affinities" jsonb,
	"affinities_for" text,
	"affinities_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rosters" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_acts" ADD CONSTRAINT "roster_acts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_acts" ADD CONSTRAINT "roster_acts_roster_id_rosters_id_fk" FOREIGN KEY ("roster_id") REFERENCES "public"."rosters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roster_acts" ADD CONSTRAINT "roster_acts_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rosters" ADD CONSTRAINT "rosters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_runs_workspace_idx" ON "job_runs" USING btree ("workspace_id","target_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "roster_acts_entity_idx" ON "roster_acts" USING btree ("roster_id","qloo_entity_id");--> statement-breakpoint
CREATE INDEX "roster_acts_workspace_idx" ON "roster_acts" USING btree ("workspace_id","roster_id");--> statement-breakpoint
CREATE INDEX "rosters_workspace_idx" ON "rosters" USING btree ("workspace_id","created_at");