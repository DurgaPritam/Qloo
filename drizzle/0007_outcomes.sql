CREATE TABLE "calibration_pairs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"kind" text NOT NULL,
	"predicted_score" double precision NOT NULL,
	"predicted_confidence" text NOT NULL,
	"outcome_metric" text NOT NULL,
	"outcome_value" double precision NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"attendance" integer,
	"tickets_sold" integer,
	"capacity" integer,
	"gross" double precision,
	"sponsor_renewed" boolean,
	"notes" text,
	"logged_by" text,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outcomes_source_check" CHECK ("outcomes"."source" = 'user')
);
--> statement-breakpoint
CREATE TABLE "plan_predictions" (
	"plan_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"predicted" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calibration_pairs" ADD CONSTRAINT "calibration_pairs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_pairs" ADD CONSTRAINT "calibration_pairs_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_logged_by_users_id_fk" FOREIGN KEY ("logged_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_predictions" ADD CONSTRAINT "plan_predictions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_predictions" ADD CONSTRAINT "plan_predictions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calibration_pairs_workspace_idx" ON "calibration_pairs" USING btree ("workspace_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "outcomes_plan_idx" ON "outcomes" USING btree ("workspace_id","plan_id");