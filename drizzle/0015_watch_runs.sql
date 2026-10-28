CREATE TABLE "watch_runs" (
	"workspace_id" text NOT NULL,
	"week" text NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "watch_runs_workspace_id_week_pk" PRIMARY KEY("workspace_id","week")
);
--> statement-breakpoint
ALTER TABLE "watch_runs" ADD CONSTRAINT "watch_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;