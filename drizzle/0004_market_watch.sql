CREATE TABLE "alerts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"item_id" text NOT NULL,
	"snapshot_id" text NOT NULL,
	"previous_snapshot_id" text NOT NULL,
	"kind" text NOT NULL,
	"list" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_name" text NOT NULL,
	"before" jsonb,
	"after" jsonb NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "digest_subscriptions" (
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"last_sent_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digest_subscriptions_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"item_id" text NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL,
	"summary" jsonb NOT NULL,
	"qloo_calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "watch_items" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"kind" text NOT NULL,
	"target_id" text NOT NULL,
	"name" text NOT NULL,
	"detail" text,
	"entity" jsonb,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_snapshot_at" timestamp with time zone,
	"next_due_at" timestamp with time zone,
	"last_note" text,
	CONSTRAINT "watch_items_kind_check" CHECK ("watch_items"."kind" in ('fanbase', 'city'))
);
--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_item_id_watch_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."watch_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_previous_snapshot_id_snapshots_id_fk" FOREIGN KEY ("previous_snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_subscriptions" ADD CONSTRAINT "digest_subscriptions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_subscriptions" ADD CONSTRAINT "digest_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshots" ADD CONSTRAINT "snapshots_item_id_watch_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."watch_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_items" ADD CONSTRAINT "watch_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "watch_items" ADD CONSTRAINT "watch_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "alerts_workspace_idx" ON "alerts" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "snapshots_item_idx" ON "snapshots" USING btree ("workspace_id","item_id","taken_at");--> statement-breakpoint
CREATE UNIQUE INDEX "watch_items_target_idx" ON "watch_items" USING btree ("workspace_id","kind","target_id");--> statement-breakpoint
CREATE INDEX "watch_items_due_idx" ON "watch_items" USING btree ("next_due_at");