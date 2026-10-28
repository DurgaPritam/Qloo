CREATE TABLE "plan_lineups" (
	"workspace_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"lineup" jsonb NOT NULL,
	"yours" jsonb NOT NULL,
	"saved_by" text,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_lineups_workspace_id_plan_id_pk" PRIMARY KEY("workspace_id","plan_id")
);
--> statement-breakpoint
ALTER TABLE "plan_lineups" ADD CONSTRAINT "plan_lineups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_lineups" ADD CONSTRAINT "plan_lineups_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_lineups" ADD CONSTRAINT "plan_lineups_saved_by_users_id_fk" FOREIGN KEY ("saved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;