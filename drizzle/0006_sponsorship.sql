CREATE TABLE "sponsor_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"view" text NOT NULL,
	"holder_key" text NOT NULL,
	"brand_id" text NOT NULL,
	"pitch" jsonb NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sponsor_matches_view_check" CHECK ("sponsor_matches"."view" in ('brand', 'rights'))
);
--> statement-breakpoint
ALTER TABLE "sponsor_matches" ADD CONSTRAINT "sponsor_matches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sponsor_matches" ADD CONSTRAINT "sponsor_matches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sponsor_matches_pair_idx" ON "sponsor_matches" USING btree ("workspace_id","holder_key","brand_id");