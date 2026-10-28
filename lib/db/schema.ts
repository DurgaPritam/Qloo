import { sql } from "drizzle-orm";
import { boolean, check, doublePrecision, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import type { Plan } from "@/lib/agent/types";
import type { Category } from "@/lib/engine/types";
import type { ActProfile, CallRecord, RosterEntity } from "@/lib/roster/types";
import type { CityOption, MetricDef } from "@/lib/data/types";
import type { ChangeKind, Snapshot } from "@/lib/engine/watch";
import type { EmailTheme } from "@/lib/email/digest-html";
import type { PitchInput } from "@/lib/export/sponsor";
import type { Prediction } from "@/lib/engine/outcomes";
import type { DeckFont } from "@/lib/export/branding";

/**
 * Every table that holds customer data has workspace_id (docs/roadmap-rules.md, rule 3).
 * Identity tables (users, accounts, sessions, verification tokens) belong to a person and have
 * the shapes @auth/drizzle-adapter expects.
 */

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () => timestamp("created_at", { mode: "date", withTimezone: true }).notNull().defaultNow();

export const ROLES = ["owner", "admin", "member", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const COMMENT_TARGETS = ["plan", "partner", "city", "venue", "sponsor"] as const;
export type CommentTarget = (typeof COMMENT_TARGETS)[number];

export const VISIBILITIES = ["workspace", "public"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/* ---------- Identity (Auth.js) ---------- */

export const users = pgTable("users", {
  id: id(),
  name: text("name"),
  email: text("email").unique(),
  emailVerified: timestamp("email_verified", { mode: "date", withTimezone: true }),
  image: text("image"),
  createdAt: createdAt(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<"email" | "oauth" | "oidc" | "webauthn">().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date", withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* ---------- Workspaces ---------- */

/** The tenant itself: scoped by its own id. */
export const workspaces = pgTable("workspaces", {
  id: id(),
  name: text("name").notNull(),
  personal: boolean("personal").notNull().default(false),
  createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: createdAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index("memberships_user_idx").on(t.userId),
    check("memberships_role_check", sql`${t.role} in ('owner', 'admin', 'member', 'viewer')`),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").$type<Exclude<Role, "owner">>().notNull(),
    /** sha256 of the token in the link; the token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { mode: "date", withTimezone: true }),
    acceptedBy: text("accepted_by").references(() => users.id, { onDelete: "set null" }),
    revokedAt: timestamp("revoked_at", { mode: "date", withTimezone: true }),
  },
  (t) => [
    index("invitations_workspace_idx").on(t.workspaceId),
    check("invitations_role_check", sql`${t.role} in ('admin', 'member', 'viewer')`),
  ],
);

/* ---------- Plans and collaboration ---------- */

export const plans = pgTable(
  "plans",
  {
    /** The run id, so /plan/<id> links work for workspace plans too. */
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    /** What the user typed. */
    input: text("input").notNull(),
    /** The finished plan exactly as the engine produced it. */
    result: jsonb("result").$type<Plan>().notNull(),
    visibility: text("visibility").$type<Visibility>().notNull().default("workspace"),
    /** Set when imported from a browser's My plans: the original public run id. */
    importedFrom: text("imported_from"),
    createdAt: createdAt(),
  },
  (t) => [
    index("plans_workspace_idx").on(t.workspaceId, t.createdAt),
    check("plans_visibility_check", sql`${t.visibility} in ('workspace', 'public')`),
  ],
);

export const comments = pgTable(
  "comments",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    targetType: text("target_type").$type<CommentTarget>().notNull(),
    /** The plan id for "plan"; the Qloo entity or city id of the decision otherwise. */
    targetId: text("target_id").notNull(),
    /** Replies point at the thread's first comment; threads are one level deep. */
    parentId: text("parent_id"),
    authorId: text("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    resolvedAt: timestamp("resolved_at", { mode: "date", withTimezone: true }),
    resolvedBy: text("resolved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("comments_plan_idx").on(t.workspaceId, t.planId),
    check("comments_target_check", sql`${t.targetType} in ('plan', 'partner', 'city', 'venue', 'sponsor')`),
  ],
);

/** In-app only for now: @mentions. */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"mention">().notNull(),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    planId: text("plan_id").references(() => plans.id, { onDelete: "cascade" }),
    commentId: text("comment_id").references(() => comments.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { mode: "date", withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("notifications_user_idx").on(t.workspaceId, t.userId)],
);

export const activityLog = pgTable(
  "activity_log",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    detail: jsonb("detail").$type<Record<string, string | number | boolean | null>>(),
    createdAt: createdAt(),
  },
  (t) => [index("activity_workspace_idx").on(t.workspaceId, t.createdAt)],
);

/* ---------- Rosters ---------- */

export const rosters = pgTable(
  "rosters",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("rosters_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const rosterActs = pgTable(
  "roster_acts",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    rosterId: text("roster_id")
      .notNull()
      .references(() => rosters.id, { onDelete: "cascade" }),
    qlooEntityId: text("qloo_entity_id").notNull(),
    name: text("name").notNull(),
    type: text("type").$type<Category>().notNull(),
    /** What the resolver returned (description, tags, home country), for the format and market. */
    entity: jsonb("entity").$type<RosterEntity>().notNull(),
    /** From an imported CSV's home_city column: the user's data, shown with that label. */
    homeCity: text("home_city"),
    addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
    /** Qloo affinity of each other act (by entity id) among this act's fans. */
    affinities: jsonb("affinities").$type<Record<string, number | null>>(),
    /** The sorted entity ids the affinities were asked for; a different roster means stale. */
    affinitiesFor: text("affinities_for"),
    affinitiesAt: timestamp("affinities_at", { mode: "date", withTimezone: true }),
    /** The Qloo requests the affinities came from, shown as their evidence. */
    affinitiesCalls: jsonb("affinities_calls").$type<CallRecord[]>(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("roster_acts_entity_idx").on(t.rosterId, t.qlooEntityId),
    index("roster_acts_workspace_idx").on(t.workspaceId, t.rosterId),
  ],
);

/**
 * Qloo picks per entity (best city, partner, sponsor), shared by every workspace: they are Qloo
 * data about a public entity, not customer data, so there is no workspace_id. Keyed by source, so
 * sample data never stands in for a live profile.
 */
export const entityProfiles = pgTable("entity_profiles", {
  key: text("key").primaryKey(),
  entityId: text("entity_id").notNull(),
  mock: boolean("mock").notNull(),
  profile: jsonb("profile").$type<ActProfile>().notNull(),
  refreshedAt: timestamp("refreshed_at", { mode: "date", withTimezone: true }).notNull(),
});

export const JOB_STATUSES = ["queued", "running", "done", "failed", "skipped_budget"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Background work for one workspace, recorded whatever happens (docs/architecture.md). */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"roster.refresh" | "watch.refresh">().notNull(),
    /** What the job is about, e.g. the roster id. */
    targetId: text("target_id"),
    status: text("status").$type<JobStatus>().notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    /** Uncached Qloo calls the job made. */
    qlooCalls: integer("qloo_calls").notNull().default(0),
    note: text("note"),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { mode: "date", withTimezone: true }),
    finishedAt: timestamp("finished_at", { mode: "date", withTimezone: true }),
  },
  (t) => [
    index("job_runs_workspace_idx").on(t.workspaceId, t.targetId, t.createdAt),
    check("job_runs_status_check", sql`${t.status} in ('queued', 'running', 'done', 'failed', 'skipped_budget')`),
  ],
);

/* ---------- Your data (docs/roadmap-rules.md, rule 2) ---------- */

/** An uploaded file of the user's own numbers by city. Never sent to the model, never shown outside the workspace. */
export const datasets = pgTable(
  "datasets",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Always "user": these numbers were entered by a person and are not checked. */
    source: text("source").$type<"user">().notNull().default("user"),
    name: text("name").notNull(),
    fileKind: text("file_kind").$type<"csv" | "xlsx">().notNull(),
    /** The stored file (private Blob pathname, or a local key). */
    fileKey: text("file_key").notNull(),
    fileBytes: integer("file_bytes").notNull(),
    cityColumn: text("city_column").notNull(),
    countryColumn: text("country_column"),
    metrics: jsonb("metrics").$type<MetricDef[]>().notNull(),
    /** The fanbase (Qloo entity) the data is about; null until attached. */
    entityId: text("entity_id"),
    entityName: text("entity_name"),
    entityCategory: text("entity_category").$type<Category>(),
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    uploadedAt: timestamp("uploaded_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("datasets_workspace_idx").on(t.workspaceId, t.uploadedAt),
    index("datasets_entity_idx").on(t.workspaceId, t.entityId),
    check("datasets_source_check", sql`${t.source} = 'user'`),
  ],
);

export const MATCH_STATUSES = ["matched", "manual", "ambiguous", "unmatched", "skipped"] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const datasetRows = pgTable(
  "dataset_rows",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    datasetId: text("dataset_id")
      .notNull()
      .references(() => datasets.id, { onDelete: "cascade" }),
    source: text("source").$type<"user">().notNull().default("user"),
    rowNumber: integer("row_number").notNull(),
    rawCity: text("raw_city").notNull(),
    rawCountry: text("raw_country"),
    /** The GeoNames metro the row counts towards, once matched. */
    cityId: text("city_id"),
    matchStatus: text("match_status").$type<MatchStatus>().notNull(),
    matchNote: text("match_note"),
    options: jsonb("options").$type<CityOption[]>(),
    /** Metric key → value; null where the cell was not a number. */
    metrics: jsonb("metrics").$type<Record<string, number | null>>().notNull(),
  },
  (t) => [
    index("dataset_rows_dataset_idx").on(t.workspaceId, t.datasetId),
    check("dataset_rows_source_check", sql`${t.source} = 'user'`),
    check("dataset_rows_status_check", sql`${t.matchStatus} in ('matched', 'manual', 'ambiguous', 'unmatched', 'skipped')`),
  ],
);

/* ---------- Market watch ---------- */

export const WATCH_KINDS = ["fanbase", "city"] as const;
export type WatchKind = (typeof WATCH_KINDS)[number];

/** A fanbase (Qloo entity) or a city (GeoNames metro) re-checked weekly. */
export const watchItems = pgTable(
  "watch_items",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: text("kind").$type<WatchKind>().notNull(),
    /** Qloo entity id for a fanbase, GeoNames id for a city. */
    targetId: text("target_id").notNull(),
    name: text("name").notNull(),
    /** Fanbase: Qloo category. City: ISO country code. */
    detail: text("detail"),
    /** Fanbase: the resolver's entity snapshot (for its market and format). */
    entity: jsonb("entity").$type<RosterEntity>(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    lastSnapshotAt: timestamp("last_snapshot_at", { mode: "date", withTimezone: true }),
    nextDueAt: timestamp("next_due_at", { mode: "date", withTimezone: true }),
    /** What the last check did, in plain words (skipped for budget, Qloo did not answer…). */
    lastNote: text("last_note"),
  },
  (t) => [
    uniqueIndex("watch_items_target_idx").on(t.workspaceId, t.kind, t.targetId),
    index("watch_items_due_idx").on(t.nextDueAt),
    check("watch_items_kind_check", sql`${t.kind} in ('fanbase', 'city')`),
  ],
);

export const snapshots = pgTable(
  "snapshots",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => watchItems.id, { onDelete: "cascade" }),
    takenAt: timestamp("taken_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
    /** Ranked top lists with entity ids, ranks and values, as Qloo and the engine gave them. */
    summary: jsonb("summary").$type<Snapshot & { market?: string; calls: CallRecord[] }>().notNull(),
    qlooCalls: integer("qloo_calls").notNull().default(0),
  },
  (t) => [index("snapshots_item_idx").on(t.workspaceId, t.itemId, t.takenAt)],
);

export const alerts = pgTable(
  "alerts",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    itemId: text("item_id")
      .notNull()
      .references(() => watchItems.id, { onDelete: "cascade" }),
    /** The two snapshots compared: every alert needs both. */
    snapshotId: text("snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    previousSnapshotId: text("previous_snapshot_id")
      .notNull()
      .references(() => snapshots.id, { onDelete: "cascade" }),
    kind: text("kind").$type<ChangeKind>().notNull(),
    list: text("list").notNull(),
    entityId: text("entity_id").notNull(),
    entityName: text("entity_name").notNull(),
    before: jsonb("before").$type<{ rank: number; value: number } | null>(),
    after: jsonb("after").$type<{ rank: number; value: number }>().notNull(),
    /** Filled from templates (lib/watch/wording.ts), never written by the model. */
    title: text("title").notNull(),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("alerts_workspace_idx").on(t.workspaceId, t.createdAt)],
);

/**
 * The weekly digest, per person and workspace: off until the person turns it on. Unsubscribe
 * links carry a signed token (lib/watch/digest.ts), so nothing secret is stored here.
 */
export const digestSubscriptions = pgTable(
  "digest_subscriptions",
  {
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    /** The look of the email: one of the three site themes, in email-safe colours. */
    theme: text("theme").$type<EmailTheme>().notNull().default("light"),
    lastSentAt: timestamp("last_sent_at", { mode: "date", withTimezone: true }),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

/* ---------- Sponsorship ---------- */

/**
 * A rights holder and a brand saved to the workspace's shortlist, with the fit and evidence as the
 * engine produced them (a pitch deck can be rebuilt from it without asking Qloo again).
 */
export const sponsorMatches = pgTable(
  "sponsor_matches",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** "brand": found from the brand's side; "rights": from the rights holder's. */
    view: text("view").$type<"brand" | "rights">().notNull(),
    /** Stable key of the rights holder: its Qloo id(s), sorted. */
    holderKey: text("holder_key").notNull(),
    brandId: text("brand_id").notNull(),
    pitch: jsonb("pitch").$type<PitchInput>().notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sponsor_matches_pair_idx").on(t.workspaceId, t.holderKey, t.brandId),
    check("sponsor_matches_view_check", sql`${t.view} in ('brand', 'rights')`),
  ],
);

/* ---------- Outcomes ---------- */

/**
 * What a plan predicted, written once when the plan is saved to the workspace and never updated:
 * outcomes compare against this, not against a recomputation.
 */
export const planPredictions = pgTable("plan_predictions", {
  planId: text("plan_id")
    .primaryKey()
    .references(() => plans.id, { onDelete: "cascade" }),
  workspaceId: text("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  predicted: jsonb("predicted").$type<Prediction>().notNull(),
  createdAt: createdAt(),
});

/** Results logged after an event: the user's data, every field optional. One row per plan. */
export const outcomes = pgTable(
  "outcomes",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    source: text("source").$type<"user">().notNull().default("user"),
    attendance: integer("attendance"),
    ticketsSold: integer("tickets_sold"),
    capacity: integer("capacity"),
    gross: doublePrecision("gross"),
    sponsorRenewed: boolean("sponsor_renewed"),
    notes: text("notes"),
    loggedBy: text("logged_by").references(() => users.id, { onDelete: "set null" }),
    loggedAt: timestamp("logged_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("outcomes_plan_idx").on(t.workspaceId, t.planId),
    check("outcomes_source_check", sql`${t.source} = 'user'`),
  ],
);

/**
 * For calibration later: each plan's predicted score next to what happened. Stored, never used to
 * change scoring (docs/decisions.md describes how it could be).
 */
export const calibrationPairs = pgTable(
  "calibration_pairs",
  {
    id: id(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    /** What was predicted: the chosen city's combined score or the chosen partner's score. */
    kind: text("kind").$type<"city" | "partner">().notNull(),
    predictedScore: doublePrecision("predicted_score").notNull(),
    predictedConfidence: text("predicted_confidence").notNull(),
    /** The outcome it is paired with; only sell-through for now. */
    outcomeMetric: text("outcome_metric").$type<"sell_through">().notNull(),
    outcomeValue: doublePrecision("outcome_value").notNull(),
    recordedAt: createdAt(),
  },
  (t) => [index("calibration_pairs_workspace_idx").on(t.workspaceId, t.kind)],
);

/* ---------- Branded decks (Feature 10) ---------- */

/** One row per workspace: applied to every deck it exports. No row = Takeover's house deck. */
export const deckSettings = pgTable("deck_settings", {
  workspaceId: text("workspace_id")
    .primaryKey()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  bg: text("bg").notNull(),
  text: text("text").notNull(),
  accent: text("accent").notNull(),
  font: text("font").$type<DeckFont>().notNull(),
  /** A small PNG or JPEG as a data URL (at most 300 KB), so decks built in the browser can embed it. */
  logoData: text("logo_data"),
  logoWidth: integer("logo_width"),
  logoHeight: integer("logo_height"),
  updatedBy: text("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true }).notNull().defaultNow(),
});

/** Tables that must be scoped by workspace_id in every query (tests/support/scoped-queries.ts). */
export const TENANT_TABLES = [
  "memberships",
  "invitations",
  "plans",
  "comments",
  "notifications",
  "activity_log",
  "rosters",
  "roster_acts",
  "job_runs",
  "datasets",
  "dataset_rows",
  "watch_items",
  "snapshots",
  "alerts",
  "digest_subscriptions",
  "sponsor_matches",
  "plan_predictions",
  "outcomes",
  "calibration_pairs",
  "deck_settings",
] as const;
