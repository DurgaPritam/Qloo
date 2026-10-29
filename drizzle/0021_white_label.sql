CREATE TABLE "white_label" (
	"workspace_id" text PRIMARY KEY NOT NULL,
	"public_id" text NOT NULL,
	"domain" text,
	"domain_token" text,
	"domain_verified_at" timestamp with time zone,
	"embed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "white_label" ADD CONSTRAINT "white_label_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "white_label_public_idx" ON "white_label" USING btree ("public_id");--> statement-breakpoint
CREATE UNIQUE INDEX "white_label_domain_idx" ON "white_label" USING btree ("domain");