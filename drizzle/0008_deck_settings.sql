CREATE TABLE "deck_settings" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"bg" text NOT NULL,
	"text" text NOT NULL,
	"accent" text NOT NULL,
	"font" text NOT NULL,
	"logo_data" text,
	"logo_width" integer,
	"logo_height" integer,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deck_settings" ADD CONSTRAINT "deck_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deck_settings" ADD CONSTRAINT "deck_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;