CREATE TABLE "dataset_rows" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"dataset_id" text NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"row_number" integer NOT NULL,
	"raw_city" text NOT NULL,
	"raw_country" text,
	"city_id" text,
	"match_status" text NOT NULL,
	"match_note" text,
	"options" jsonb,
	"metrics" jsonb NOT NULL,
	CONSTRAINT "dataset_rows_source_check" CHECK ("dataset_rows"."source" = 'user'),
	CONSTRAINT "dataset_rows_status_check" CHECK ("dataset_rows"."match_status" in ('matched', 'manual', 'ambiguous', 'unmatched', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source" text DEFAULT 'user' NOT NULL,
	"name" text NOT NULL,
	"file_kind" text NOT NULL,
	"file_key" text NOT NULL,
	"file_bytes" integer NOT NULL,
	"city_column" text NOT NULL,
	"country_column" text,
	"metrics" jsonb NOT NULL,
	"entity_id" text,
	"entity_name" text,
	"entity_category" text,
	"uploaded_by" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "datasets_source_check" CHECK ("datasets"."source" = 'user')
);
--> statement-breakpoint
ALTER TABLE "dataset_rows" ADD CONSTRAINT "dataset_rows_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dataset_rows" ADD CONSTRAINT "dataset_rows_dataset_id_datasets_id_fk" FOREIGN KEY ("dataset_id") REFERENCES "public"."datasets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasets" ADD CONSTRAINT "datasets_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dataset_rows_dataset_idx" ON "dataset_rows" USING btree ("workspace_id","dataset_id");--> statement-breakpoint
CREATE INDEX "datasets_workspace_idx" ON "datasets" USING btree ("workspace_id","uploaded_at");--> statement-breakpoint
CREATE INDEX "datasets_entity_idx" ON "datasets" USING btree ("workspace_id","entity_id");