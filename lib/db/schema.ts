import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

import type { Plan } from "@/lib/agent/types";
import type { Category } from "@/lib/engine/types";
import type { ActProfile, RosterEntity } from "@/lib/roster/types";

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
    kind: text("kind").$type<"roster.refresh">().notNull(),
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
] as const;
