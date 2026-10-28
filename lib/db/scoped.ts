import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, asc, count, desc, eq, gt, gte, ilike, inArray, isNull, lte, or } from "drizzle-orm";

import type { ActProfile, CallRecord, RosterEntity } from "@/lib/roster/types";
import type { CityOption, MetricDef } from "@/lib/data/types";
import type { Category } from "@/lib/engine/types";
import type { ChangeKind, Snapshot } from "@/lib/engine/watch";
import type { EmailTheme } from "@/lib/email/digest-html";
import type { PitchInput } from "@/lib/export/sponsor";
import type { DeckFont } from "@/lib/export/branding";
import { sellThrough, type Prediction } from "@/lib/engine/outcomes";
import { predictionsFromPlan } from "@/lib/outcomes/predict";
import { cardFromMatch, cardsFromPlan, contentHash, type NewCard } from "@/lib/pipeline/drafts";
import type { OutreachStage } from "@/lib/pipeline/stages";

import type { Plan } from "@/lib/agent/types";
import { mentionedUserIds } from "@/lib/workspace/mentions";
import { assignableRoles, can, canManage, ForbiddenError, type Action } from "@/lib/workspace/permissions";
import { isPlanTarget } from "@/lib/workspace/targets";

import type { DB } from "./index";
import {
  activityLog,
  comments,
  alerts,
  calibrationPairs,
  datasetRows,
  datasets,
  deckSettings,
  digestSubscriptions,
  entityProfiles,
  invitations,
  jobRuns,
  memberships,
  notifications,
  outcomes,
  outreach,
  outreachEvents,
  planPredictions,
  plans,
  rosterActs,
  rosters,
  snapshots,
  sponsorMatches,
  users,
  watchItems,
  workspaces,
  type CommentTarget,
  type JobStatus,
  type MatchStatus,
  type WatchKind,
  type Role,
  type Visibility,
} from "./schema";

/**
 * The scoped repository (docs/roadmap-rules.md, rule 3). Every query adds
 * workspace_id = ctx.workspaceId, and every write checks the caller's role first.
 * A context comes only from lib/workspace/context.ts, which checks the membership.
 */
export interface WorkspaceContext {
  userId: string;
  workspaceId: string;
  role: Role;
}

export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputError";
  }
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_COMMENT = 2000;
const MAX_NAME = 60;
/** Pairings grow with the square of the roster, and each refresh asks Qloo once per act. */
export const MAX_ROSTER_ACTS = 40;
/** Each watch costs a few Qloo calls a week. */
export const MAX_WATCH_ITEMS = 30;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");
export const normaliseEmail = (email: string) => email.trim().toLowerCase();
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function forWorkspace(db: DB, ctx: WorkspaceContext) {
  const ws = ctx.workspaceId;
  const need = (action: Action) => {
    if (!can(ctx.role, action)) throw new ForbiddenError(action);
  };
  const log = (action: string, target?: { type: string; id: string }, detail?: Record<string, string | number | boolean | null>) =>
    db.insert(activityLog).values({ workspaceId: ws, actorId: ctx.userId, action, targetType: target?.type, targetId: target?.id, detail });

  const memberRows = () =>
    db
      .select({ userId: memberships.userId, role: memberships.role, joinedAt: memberships.createdAt, email: users.email, name: users.name })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.workspaceId, ws))
      .orderBy(asc(memberships.createdAt));

  const planById = async (id: string) =>
    (await db.select().from(plans).where(and(eq(plans.workspaceId, ws), eq(plans.id, id))).limit(1))[0] ?? null;

  const rosterById = async (id: string) =>
    (await db.select().from(rosters).where(and(eq(rosters.workspaceId, ws), eq(rosters.id, id))).limit(1))[0] ?? null;
  const actRows = (rosterId: string) =>
    db
      .select()
      .from(rosterActs)
      .where(and(eq(rosterActs.workspaceId, ws), eq(rosterActs.rosterId, rosterId)))
      .orderBy(asc(rosterActs.createdAt), asc(rosterActs.id));

  const repo = {
    context: ctx,

    workspace: {
      async get() {
        return (await db.select().from(workspaces).where(eq(workspaces.id, ws)).limit(1))[0] ?? null;
      },
      async rename(name: string) {
        need("workspace.rename");
        const clean = name.trim().slice(0, MAX_NAME);
        if (!clean) throw new InputError("Give the workspace a name.");
        await db.update(workspaces).set({ name: clean }).where(eq(workspaces.id, ws));
        await log("workspace.renamed", { type: "workspace", id: ws }, { name: clean });
      },
    },

    plans: {
      async list(limit = 100) {
        need("plan.read");
        return db
          .select({ id: plans.id, input: plans.input, result: plans.result, visibility: plans.visibility, createdAt: plans.createdAt, createdBy: plans.createdBy, author: users.name, authorEmail: users.email })
          .from(plans)
          .leftJoin(users, eq(users.id, plans.createdBy))
          .where(eq(plans.workspaceId, ws))
          .orderBy(desc(plans.createdAt))
          .limit(limit);
      },
      async get(id: string) {
        need("plan.read");
        return planById(id);
      },
      async create(input: { id: string; query: string; result: Plan }) {
        need("plan.create");
        await db.insert(plans).values({ id: input.id, workspaceId: ws, createdBy: ctx.userId, input: input.query, result: input.result });
        // Frozen now: outcomes compare against what the plan predicted when it was made.
        await db.insert(planPredictions).values({ planId: input.id, workspaceId: ws, predicted: predictionsFromPlan(input.result) });
        await log("plan.created", { type: "plan", id: input.id }, { input: input.query });
      },
      async setVisibility(id: string, visibility: Visibility) {
        const plan = await planById(id);
        if (!plan) throw new InputError("That plan isn't in this workspace.");
        if (!can(ctx.role, "plan.share.any") && !(can(ctx.role, "plan.share.own") && plan.createdBy === ctx.userId)) {
          throw new ForbiddenError("plan.share");
        }
        await db.update(plans).set({ visibility }).where(and(eq(plans.workspaceId, ws), eq(plans.id, id)));
        await log("plan.visibility", { type: "plan", id }, { visibility });
      },
      /**
       * Copies plans from a browser's My plans. Each copy gets a new id, so links already shared
       * from the browser keep pointing at the public original. Re-importing is a no-op.
       */
      async importFromBrowser(found: readonly Plan[]) {
        need("plan.create");
        if (!found.length) return { imported: 0, already: 0 };
        const existing = await db
          .select({ importedFrom: plans.importedFrom })
          .from(plans)
          .where(and(eq(plans.workspaceId, ws), inArray(plans.importedFrom, found.map((p) => p.runId))));
        const done = new Set(existing.map((e) => e.importedFrom));
        const fresh = found.filter((p) => !done.has(p.runId));
        if (fresh.length) {
          const rows = fresh.map((p) => {
            const id = crypto.randomUUID();
            return { id, workspaceId: ws, createdBy: ctx.userId, input: p.query, result: { ...p, runId: id }, importedFrom: p.runId };
          });
          await db.insert(plans).values(rows);
          await db.insert(planPredictions).values(rows.map((r) => ({ planId: r.id, workspaceId: ws, predicted: predictionsFromPlan(r.result) })));
          await log("plan.imported", { type: "workspace", id: ws }, { count: fresh.length });
        }
        return { imported: fresh.length, already: found.length - fresh.length };
      },
    },

    comments: {
      async list(planId: string) {
        need("comment.read");
        return db
          .select({
            id: comments.id,
            planId: comments.planId,
            targetType: comments.targetType,
            targetId: comments.targetId,
            parentId: comments.parentId,
            body: comments.body,
            authorId: comments.authorId,
            author: users.name,
            authorEmail: users.email,
            resolvedAt: comments.resolvedAt,
            createdAt: comments.createdAt,
          })
          .from(comments)
          .leftJoin(users, eq(users.id, comments.authorId))
          .where(and(eq(comments.workspaceId, ws), eq(comments.planId, planId)))
          .orderBy(asc(comments.createdAt));
      },
      async add(input: { planId: string; targetType: CommentTarget; targetId: string; parentId?: string | null; body: string }) {
        need("comment.create");
        const body = input.body.trim();
        if (!body) throw new InputError("Write something first.");
        if (body.length > MAX_COMMENT) throw new InputError(`Keep comments under ${MAX_COMMENT} characters.`);
        const plan = await planById(input.planId);
        if (!plan) throw new InputError("That plan isn't in this workspace.");
        if (!isPlanTarget(plan.result, input.targetType, input.targetId)) throw new InputError("That isn't one of this plan's decisions.");
        let parentId: string | null = null;
        if (input.parentId) {
          const parent = (
            await db
              .select({ id: comments.id, parentId: comments.parentId, planId: comments.planId, targetType: comments.targetType, targetId: comments.targetId })
              .from(comments)
              .where(and(eq(comments.workspaceId, ws), eq(comments.id, input.parentId)))
              .limit(1)
          )[0];
          if (!parent || parent.planId !== input.planId) throw new InputError("That thread isn't on this plan.");
          // Threads are one level deep: a reply to a reply joins the same thread.
          parentId = parent.parentId ?? parent.id;
          if (parent.targetType !== input.targetType || parent.targetId !== input.targetId) throw new InputError("Reply on the same decision.");
        }
        const id = crypto.randomUUID();
        await db.insert(comments).values({ id, workspaceId: ws, planId: input.planId, targetType: input.targetType, targetId: input.targetId, parentId, authorId: ctx.userId, body });
        const mentioned = mentionedUserIds(body, await memberRows()).filter((u) => u !== ctx.userId);
        if (mentioned.length) {
          await db.insert(notifications).values(
            mentioned.map((userId) => ({ workspaceId: ws, userId, kind: "mention" as const, actorId: ctx.userId, planId: input.planId, commentId: id })),
          );
        }
        await log("comment.created", { type: "comment", id }, { planId: input.planId, target: input.targetType, mentions: mentioned.length });
        return { id, mentioned };
      },
      async resolve(id: string, resolved: boolean) {
        need("comment.resolve");
        const row = (
          await db.select({ parentId: comments.parentId }).from(comments).where(and(eq(comments.workspaceId, ws), eq(comments.id, id))).limit(1)
        )[0];
        if (!row) throw new InputError("That comment isn't in this workspace.");
        if (row.parentId) throw new InputError("Resolve the thread from its first comment.");
        await db
          .update(comments)
          .set(resolved ? { resolvedAt: new Date(), resolvedBy: ctx.userId } : { resolvedAt: null, resolvedBy: null })
          .where(and(eq(comments.workspaceId, ws), eq(comments.id, id)));
        await log(resolved ? "comment.resolved" : "comment.reopened", { type: "comment", id });
      },
    },

    members: {
      async list() {
        need("member.read");
        return memberRows();
      },
      async changeRole(userId: string, role: Role) {
        const rows = await memberRows();
        const target = rows.find((m) => m.userId === userId);
        if (!target) throw new InputError("That person isn't in this workspace.");
        if (!canManage(ctx.role, target.role) || !assignableRoles(ctx.role).includes(role)) throw new ForbiddenError("member.manage");
        if (target.role === "owner" && role !== "owner" && rows.filter((m) => m.role === "owner").length === 1) {
          throw new InputError("A workspace needs at least one owner.");
        }
        await db.update(memberships).set({ role }).where(and(eq(memberships.workspaceId, ws), eq(memberships.userId, userId)));
        await log("member.role_changed", { type: "user", id: userId }, { from: target.role, to: role });
      },
      /** Removes a member, or lets anyone leave. */
      async remove(userId: string) {
        const rows = await memberRows();
        const target = rows.find((m) => m.userId === userId);
        if (!target) throw new InputError("That person isn't in this workspace.");
        if (userId !== ctx.userId && !canManage(ctx.role, target.role)) throw new ForbiddenError("member.manage");
        if (target.role === "owner" && rows.filter((m) => m.role === "owner").length === 1) {
          throw new InputError("A workspace needs at least one owner. Make someone else an owner first.");
        }
        await db.delete(memberships).where(and(eq(memberships.workspaceId, ws), eq(memberships.userId, userId)));
        await log(userId === ctx.userId ? "member.left" : "member.removed", { type: "user", id: userId });
      },
    },

    invitations: {
      async listPending() {
        need("member.invite");
        return db
          .select({ id: invitations.id, email: invitations.email, role: invitations.role, createdAt: invitations.createdAt, expiresAt: invitations.expiresAt })
          .from(invitations)
          .where(and(eq(invitations.workspaceId, ws), isNull(invitations.acceptedAt), isNull(invitations.revokedAt), gt(invitations.expiresAt, new Date())))
          .orderBy(desc(invitations.createdAt));
      },
      /** Returns the token for the link; only its hash is stored. A new invite replaces a pending one. */
      async create(emailRaw: string, role: Exclude<Role, "owner">) {
        need("member.invite");
        const email = normaliseEmail(emailRaw);
        if (!EMAIL.test(email)) throw new InputError("Enter an email address.");
        if (!assignableRoles(ctx.role).includes(role) || (role as Role) === "owner") throw new ForbiddenError("member.invite");
        if ((await memberRows()).some((m) => m.email?.toLowerCase() === email)) throw new InputError("They're already in this workspace.");
        await db
          .update(invitations)
          .set({ revokedAt: new Date() })
          .where(and(eq(invitations.workspaceId, ws), eq(invitations.email, email), isNull(invitations.acceptedAt), isNull(invitations.revokedAt)));
        const token = newToken();
        const id = crypto.randomUUID();
        await db.insert(invitations).values({ id, workspaceId: ws, email, role, tokenHash: hashToken(token), invitedBy: ctx.userId, expiresAt: new Date(Date.now() + INVITE_TTL_MS) });
        await log("member.invited", { type: "invitation", id }, { email, role });
        return { id, token, email, role };
      },
      async revoke(id: string) {
        need("member.invite");
        await db.update(invitations).set({ revokedAt: new Date() }).where(and(eq(invitations.workspaceId, ws), eq(invitations.id, id), isNull(invitations.acceptedAt)));
        await log("member.invite_revoked", { type: "invitation", id });
      },
    },

    notifications: {
      async list(limit = 50) {
        return db
          .select({ id: notifications.id, kind: notifications.kind, planId: notifications.planId, commentId: notifications.commentId, readAt: notifications.readAt, createdAt: notifications.createdAt, actor: users.name, actorEmail: users.email, body: comments.body, planInput: plans.input })
          .from(notifications)
          .leftJoin(users, eq(users.id, notifications.actorId))
          .leftJoin(comments, and(eq(comments.id, notifications.commentId), eq(comments.workspaceId, ws)))
          .leftJoin(plans, and(eq(plans.id, notifications.planId), eq(plans.workspaceId, ws)))
          .where(and(eq(notifications.workspaceId, ws), eq(notifications.userId, ctx.userId)))
          .orderBy(desc(notifications.createdAt))
          .limit(limit);
      },
      async unread() {
        const [row] = await db
          .select({ n: count() })
          .from(notifications)
          .where(and(eq(notifications.workspaceId, ws), eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
        return row?.n ?? 0;
      },
      async markAllRead() {
        await db
          .update(notifications)
          .set({ readAt: new Date() })
          .where(and(eq(notifications.workspaceId, ws), eq(notifications.userId, ctx.userId), isNull(notifications.readAt)));
      },
    },

    rosters: {
      async list() {
        need("roster.read");
        return db
          .select({ id: rosters.id, name: rosters.name, createdAt: rosters.createdAt, acts: count(rosterActs.id) })
          .from(rosters)
          .leftJoin(rosterActs, and(eq(rosterActs.rosterId, rosters.id), eq(rosterActs.workspaceId, ws)))
          .where(eq(rosters.workspaceId, ws))
          .groupBy(rosters.id)
          .orderBy(desc(rosters.createdAt));
      },
      async get(id: string) {
        need("roster.read");
        return rosterById(id);
      },
      async create(name: string) {
        need("roster.edit");
        const clean = name.trim().slice(0, MAX_NAME);
        if (!clean) throw new InputError("Give the roster a name.");
        const id = crypto.randomUUID();
        await db.insert(rosters).values({ id, workspaceId: ws, name: clean, createdBy: ctx.userId });
        await log("roster.created", { type: "roster", id }, { name: clean });
        return id;
      },
      async rename(id: string, name: string) {
        need("roster.edit");
        const clean = name.trim().slice(0, MAX_NAME);
        if (!clean) throw new InputError("Give the roster a name.");
        await db.update(rosters).set({ name: clean }).where(and(eq(rosters.workspaceId, ws), eq(rosters.id, id)));
      },
      async remove(id: string) {
        need("roster.edit");
        await db.delete(rosters).where(and(eq(rosters.workspaceId, ws), eq(rosters.id, id)));
        await log("roster.deleted", { type: "roster", id });
      },
      async acts(rosterId: string) {
        need("roster.read");
        return actRows(rosterId);
      },
      /** Adds the acts that are not on the roster yet; returns which were added and which were already there. */
      async addActs(rosterId: string, entries: readonly { entity: RosterEntity; homeCity?: string | null }[], via: "search" | "csv") {
        need("roster.edit");
        if (!(await rosterById(rosterId))) throw new InputError("That roster isn't in this workspace.");
        const existing = new Set((await actRows(rosterId)).map((a) => a.qlooEntityId));
        const fresh = entries.filter((e, i) => !existing.has(e.entity.id) && entries.findIndex((x) => x.entity.id === e.entity.id) === i);
        if (existing.size + fresh.length > MAX_ROSTER_ACTS) {
          throw new InputError(`A roster holds up to ${MAX_ROSTER_ACTS} acts; this one has ${existing.size}.`);
        }
        if (fresh.length) {
          await db.insert(rosterActs).values(
            fresh.map(({ entity, homeCity }) => ({
              workspaceId: ws,
              rosterId,
              qlooEntityId: entity.id,
              name: entity.name,
              type: entity.category,
              entity,
              homeCity: homeCity?.trim().slice(0, 80) || null,
              addedBy: ctx.userId,
            })),
          );
          await log("roster.acts_added", { type: "roster", id: rosterId }, { count: fresh.length, via });
        }
        return { added: fresh.map((e) => e.entity.id), already: entries.length - fresh.length };
      },
      async removeAct(rosterId: string, actId: string) {
        need("roster.edit");
        await db.delete(rosterActs).where(and(eq(rosterActs.workspaceId, ws), eq(rosterActs.rosterId, rosterId), eq(rosterActs.id, actId)));
      },
      async setAffinities(rosterId: string, actId: string, affinities: Record<string, number | null>, forKey: string, at: Date, calls: CallRecord[]) {
        need("roster.edit");
        await db
          .update(rosterActs)
          .set({ affinities, affinitiesFor: forKey, affinitiesAt: at, affinitiesCalls: calls })
          .where(and(eq(rosterActs.workspaceId, ws), eq(rosterActs.rosterId, rosterId), eq(rosterActs.id, actId)));
      },
    },

    /**
     * The shared per-entity cache of Qloo picks. Not customer data (no workspace_id): every
     * workspace with the same act reads the same profile, so it is fetched once a week at most.
     */
    entityProfiles: {
      async get(keys: readonly string[]) {
        if (!keys.length) return [];
        return db.select().from(entityProfiles).where(inArray(entityProfiles.key, [...keys]));
      },
      async put(key: string, profile: ActProfile, at: Date) {
        await db
          .insert(entityProfiles)
          .values({ key, entityId: profile.entityId, mock: profile.mock, profile, refreshedAt: at })
          .onConflictDoUpdate({ target: entityProfiles.key, set: { profile, mock: profile.mock, refreshedAt: at } });
      },
    },

    jobs: {
      async create(input: { kind: "roster.refresh" | "watch.refresh"; targetId: string; status: JobStatus; payload?: Record<string, unknown>; note?: string }) {
        need(input.kind === "roster.refresh" ? "roster.edit" : "watch.read");
        const id = crypto.randomUUID();
        await db.insert(jobRuns).values({ id, workspaceId: ws, createdBy: ctx.userId, ...input });
        return id;
      },
      async get(id: string) {
        return (await db.select().from(jobRuns).where(and(eq(jobRuns.workspaceId, ws), eq(jobRuns.id, id))).limit(1))[0] ?? null;
      },
      async update(id: string, patch: { status?: JobStatus; qlooCalls?: number; note?: string | null; startedAt?: Date; finishedAt?: Date }) {
        await db.update(jobRuns).set(patch).where(and(eq(jobRuns.workspaceId, ws), eq(jobRuns.id, id)));
      },
      async listFor(targetId: string, limit = 20) {
        return db
          .select()
          .from(jobRuns)
          .where(and(eq(jobRuns.workspaceId, ws), eq(jobRuns.targetId, targetId)))
          .orderBy(desc(jobRuns.createdAt))
          .limit(limit);
      },
    },

    /** The user's own data (rule 2). Every read and write carries workspace_id; nothing here reaches the model. */
    datasets: {
      async list() {
        need("data.read");
        return db
          .select({
            id: datasets.id,
            name: datasets.name,
            fileKind: datasets.fileKind,
            metrics: datasets.metrics,
            entityId: datasets.entityId,
            entityName: datasets.entityName,
            entityCategory: datasets.entityCategory,
            uploadedAt: datasets.uploadedAt,
            uploader: users.name,
            uploaderEmail: users.email,
          })
          .from(datasets)
          .leftJoin(users, eq(users.id, datasets.uploadedBy))
          .where(eq(datasets.workspaceId, ws))
          .orderBy(desc(datasets.uploadedAt));
      },
      async get(id: string) {
        need("data.read");
        return (await db.select().from(datasets).where(and(eq(datasets.workspaceId, ws), eq(datasets.id, id))).limit(1))[0] ?? null;
      },
      async create(input: {
        name: string;
        fileKind: "csv" | "xlsx";
        fileKey: string;
        fileBytes: number;
        cityColumn: string;
        countryColumn: string | null;
        metrics: MetricDef[];
        rows: { rowNumber: number; rawCity: string; rawCountry: string | null; cityId: string | null; matchStatus: MatchStatus; matchNote: string | null; options: CityOption[] | null; metrics: Record<string, number | null> }[];
      }) {
        need("data.edit");
        const { rows, ...meta } = input;
        const id = crypto.randomUUID();
        await db.transaction(async (tx) => {
          await tx.insert(datasets).values({ id, workspaceId: ws, uploadedBy: ctx.userId, ...meta });
          for (let i = 0; i < rows.length; i += 500) {
            await tx.insert(datasetRows).values(rows.slice(i, i + 500).map((r) => ({ ...r, workspaceId: ws, datasetId: id })));
          }
        });
        await log("data.uploaded", { type: "dataset", id }, { name: meta.name, rows: rows.length });
        return id;
      },
      async rows(id: string) {
        need("data.read");
        return db
          .select()
          .from(datasetRows)
          .where(and(eq(datasetRows.workspaceId, ws), eq(datasetRows.datasetId, id)))
          .orderBy(asc(datasetRows.rowNumber));
      },
      /** Applies a person's answer to every row with that city name (and country): a city, or skip. */
      async resolveCity(id: string, rawCity: string, rawCountry: string | null, cityId: string | null) {
        need("data.edit");
        const sameCountry = rawCountry === null ? isNull(datasetRows.rawCountry) : eq(datasetRows.rawCountry, rawCountry);
        await db
          .update(datasetRows)
          .set(cityId ? { cityId, matchStatus: "manual", matchNote: "matched by hand", options: null } : { cityId: null, matchStatus: "skipped", matchNote: "skipped by hand" })
          .where(and(eq(datasetRows.workspaceId, ws), eq(datasetRows.datasetId, id), eq(datasetRows.rawCity, rawCity), sameCountry));
      },
      async attach(id: string, entity: { id: string; name: string; category: Category } | null) {
        need("data.edit");
        await db
          .update(datasets)
          .set({ entityId: entity?.id ?? null, entityName: entity?.name ?? null, entityCategory: entity?.category ?? null })
          .where(and(eq(datasets.workspaceId, ws), eq(datasets.id, id)));
        await log("data.attached", { type: "dataset", id }, { entity: entity?.name ?? null });
      },
      /** The newest dataset attached to a fanbase, if this workspace has one. */
      async forEntity(entityId: string) {
        need("data.read");
        return (
          (
            await db
              .select()
              .from(datasets)
              .where(and(eq(datasets.workspaceId, ws), eq(datasets.entityId, entityId)))
              .orderBy(desc(datasets.uploadedAt))
              .limit(1)
          )[0] ?? null
        );
      },
      /** Deletes the dataset and its rows and clears its name from the activity log; returns the file key so the caller removes the file too. */
      async remove(id: string) {
        need("data.edit");
        const found = (await db.select({ fileKey: datasets.fileKey, name: datasets.name }).from(datasets).where(and(eq(datasets.workspaceId, ws), eq(datasets.id, id))).limit(1))[0];
        if (!found) return null;
        await db.delete(datasetRows).where(and(eq(datasetRows.workspaceId, ws), eq(datasetRows.datasetId, id)));
        await db.delete(datasets).where(and(eq(datasets.workspaceId, ws), eq(datasets.id, id)));
        // The file name and row counts leave the activity log too: only that something was deleted stays.
        await db
          .update(activityLog)
          .set({ detail: null })
          .where(and(eq(activityLog.workspaceId, ws), eq(activityLog.targetType, "dataset"), eq(activityLog.targetId, id)));
        await log("data.deleted", { type: "dataset", id });
        return found.fileKey;
      },
    },

    /** Market watch: items, their weekly snapshots and the alerts from comparing two of them. */
    watch: {
      async items() {
        need("watch.read");
        return db.select().from(watchItems).where(eq(watchItems.workspaceId, ws)).orderBy(asc(watchItems.createdAt));
      },
      async item(id: string) {
        need("watch.read");
        return (await db.select().from(watchItems).where(and(eq(watchItems.workspaceId, ws), eq(watchItems.id, id))).limit(1))[0] ?? null;
      },
      async add(input: { kind: WatchKind; targetId: string; name: string; detail: string | null; entity?: RosterEntity | null }) {
        need("watch.edit");
        const existing = (await db.select().from(watchItems).where(and(eq(watchItems.workspaceId, ws), eq(watchItems.kind, input.kind), eq(watchItems.targetId, input.targetId))).limit(1))[0];
        if (existing) return { id: existing.id, added: false };
        const [{ n }] = await db.select({ n: count() }).from(watchItems).where(eq(watchItems.workspaceId, ws));
        if (n >= MAX_WATCH_ITEMS) throw new InputError(`A workspace can watch up to ${MAX_WATCH_ITEMS} fanbases and cities.`);
        const id = crypto.randomUUID();
        await db.insert(watchItems).values({ id, workspaceId: ws, createdBy: ctx.userId, ...input, entity: input.entity ?? null });
        await log("watch.added", { type: "watch", id }, { name: input.name, kind: input.kind });
        return { id, added: true };
      },
      async remove(id: string) {
        need("watch.edit");
        await db.delete(watchItems).where(and(eq(watchItems.workspaceId, ws), eq(watchItems.id, id)));
      },
      /** Items with no snapshot yet, or whose week is up. */
      async due(now: Date) {
        return db
          .select()
          .from(watchItems)
          .where(and(eq(watchItems.workspaceId, ws), or(isNull(watchItems.nextDueAt), lte(watchItems.nextDueAt, now))))
          .orderBy(asc(watchItems.createdAt));
      },
      async setChecked(id: string, patch: { lastSnapshotAt?: Date; nextDueAt?: Date; lastNote: string | null }) {
        await db.update(watchItems).set(patch).where(and(eq(watchItems.workspaceId, ws), eq(watchItems.id, id)));
      },
      /** Newest first. */
      async snapshots(itemId: string, limit = 2) {
        need("watch.read");
        return db
          .select()
          .from(snapshots)
          .where(and(eq(snapshots.workspaceId, ws), eq(snapshots.itemId, itemId)))
          .orderBy(desc(snapshots.takenAt), desc(snapshots.id))
          .limit(limit);
      },
      async addSnapshot(itemId: string, summary: Snapshot & { market?: string; calls: CallRecord[] }, qlooCalls: number, at: Date) {
        const id = crypto.randomUUID();
        await db.insert(snapshots).values({ id, workspaceId: ws, itemId, summary, qlooCalls, takenAt: at });
        return id;
      },
      async addAlerts(
        rows: {
          itemId: string;
          snapshotId: string;
          previousSnapshotId: string;
          kind: ChangeKind;
          list: string;
          entityId: string;
          entityName: string;
          before: { rank: number; value: number } | null;
          after: { rank: number; value: number } | null;
          title: string;
          body: string;
          /** When the snapshot behind it was taken. */
          createdAt: Date;
        }[],
      ) {
        if (rows.length) await db.insert(alerts).values(rows.map((r) => ({ ...r, workspaceId: ws })));
      },
      async alerts(opts: { since?: Date; limit?: number } = {}) {
        need("watch.read");
        return db
          .select({
            id: alerts.id,
            itemId: alerts.itemId,
            itemName: watchItems.name,
            itemKind: watchItems.kind,
            itemTarget: watchItems.targetId,
            kind: alerts.kind,
            list: alerts.list,
            entityId: alerts.entityId,
            entityName: alerts.entityName,
            before: alerts.before,
            after: alerts.after,
            title: alerts.title,
            body: alerts.body,
            createdAt: alerts.createdAt,
          })
          .from(alerts)
          .innerJoin(watchItems, and(eq(watchItems.id, alerts.itemId), eq(watchItems.workspaceId, ws)))
          .where(and(eq(alerts.workspaceId, ws), opts.since ? gte(alerts.createdAt, opts.since) : undefined))
          .orderBy(desc(alerts.createdAt), asc(alerts.id))
          .limit(opts.limit ?? 50);
      },
    },

    /** The caller's own weekly digest setting in this workspace (rule 5: email to yourself needs an opt-in). */
    digest: {
      async get() {
        need("watch.read");
        return (await db.select().from(digestSubscriptions).where(and(eq(digestSubscriptions.workspaceId, ws), eq(digestSubscriptions.userId, ctx.userId))).limit(1))[0] ?? null;
      },
      async set(enabled: boolean) {
        need("watch.read");
        await db
          .insert(digestSubscriptions)
          .values({ workspaceId: ws, userId: ctx.userId, enabled })
          .onConflictDoUpdate({ target: [digestSubscriptions.workspaceId, digestSubscriptions.userId], set: { enabled, updatedAt: new Date() } });
        await log(enabled ? "digest.on" : "digest.off", { type: "user", id: ctx.userId });
      },
      /** Changing the look does not subscribe anyone. */
      async setTheme(theme: EmailTheme) {
        need("watch.read");
        await db
          .insert(digestSubscriptions)
          .values({ workspaceId: ws, userId: ctx.userId, enabled: false, theme })
          .onConflictDoUpdate({ target: [digestSubscriptions.workspaceId, digestSubscriptions.userId], set: { theme, updatedAt: new Date() } });
      },
      /** Members who turned the digest on, and are still members. */
      async recipients() {
        return db
          .select({ userId: users.id, email: users.email, name: users.name, theme: digestSubscriptions.theme })
          .from(digestSubscriptions)
          .innerJoin(memberships, and(eq(memberships.workspaceId, ws), eq(memberships.userId, digestSubscriptions.userId)))
          .innerJoin(users, eq(users.id, digestSubscriptions.userId))
          .where(and(eq(digestSubscriptions.workspaceId, ws), eq(digestSubscriptions.enabled, true)));
      },
      async markSent(userIds: readonly string[], at: Date) {
        if (!userIds.length) return;
        await db
          .update(digestSubscriptions)
          .set({ lastSentAt: at })
          .where(and(eq(digestSubscriptions.workspaceId, ws), inArray(digestSubscriptions.userId, [...userIds])));
      },
    },

    /** Sponsorship: the workspace's shortlist of rights holder and brand matches. */
    sponsorship: {
      async shortlist() {
        need("sponsor.read");
        return db.select().from(sponsorMatches).where(eq(sponsorMatches.workspaceId, ws)).orderBy(desc(sponsorMatches.createdAt));
      },
      async save(input: { view: "brand" | "rights"; holderKey: string; brandId: string; pitch: PitchInput }) {
        need("sponsor.edit");
        const id = crypto.randomUUID();
        const [row] = await db
          .insert(sponsorMatches)
          .values({ id, workspaceId: ws, createdBy: ctx.userId, ...input })
          .onConflictDoUpdate({ target: [sponsorMatches.workspaceId, sponsorMatches.holderKey, sponsorMatches.brandId], set: { pitch: input.pitch, view: input.view } })
          .returning({ id: sponsorMatches.id });
        await log("sponsor.shortlisted", { type: "sponsor_match", id: row.id }, { holder: input.pitch.holder, brand: input.pitch.brand });
        return row.id;
      },
      async remove(id: string) {
        need("sponsor.edit");
        await db.delete(sponsorMatches).where(and(eq(sponsorMatches.workspaceId, ws), eq(sponsorMatches.id, id)));
      },
    },

    /** Results logged after events (the user's data) and the predictions frozen when plans were made. */
    outcomes: {
      async prediction(planId: string) {
        need("outcome.read");
        return (await db.select().from(planPredictions).where(and(eq(planPredictions.workspaceId, ws), eq(planPredictions.planId, planId))).limit(1))[0] ?? null;
      },
      async get(planId: string) {
        need("outcome.read");
        return (await db.select().from(outcomes).where(and(eq(outcomes.workspaceId, ws), eq(outcomes.planId, planId))).limit(1))[0] ?? null;
      },
      /**
       * Saves (or replaces) a plan's results, then its calibration pairs: the frozen predicted
       * scores beside the sell-through, when both tickets sold and capacity were entered.
       */
      async save(planId: string, fields: { attendance: number | null; ticketsSold: number | null; capacity: number | null; gross: number | null; sponsorRenewed: boolean | null; notes: string | null }) {
        need("outcome.log");
        if (!(await planById(planId))) throw new InputError("That plan isn't in this workspace.");
        const now = new Date();
        await db
          .insert(outcomes)
          .values({ workspaceId: ws, planId, loggedBy: ctx.userId, loggedAt: now, ...fields })
          .onConflictDoUpdate({ target: [outcomes.workspaceId, outcomes.planId], set: { ...fields, loggedBy: ctx.userId, loggedAt: now } });
        await db.delete(calibrationPairs).where(and(eq(calibrationPairs.workspaceId, ws), eq(calibrationPairs.planId, planId)));
        const st = sellThrough(fields.ticketsSold, fields.capacity);
        const frozen = (await db.select().from(planPredictions).where(and(eq(planPredictions.workspaceId, ws), eq(planPredictions.planId, planId))).limit(1))[0];
        if (st !== null && frozen) {
          const p = frozen.predicted;
          const pairs = [
            ...(p.city ? [{ kind: "city" as const, predictedScore: p.city.combined, predictedConfidence: p.city.confidence }] : []),
            ...(p.partner ? [{ kind: "partner" as const, predictedScore: p.partner.score, predictedConfidence: p.partner.confidence }] : []),
          ];
          if (pairs.length) {
            await db.insert(calibrationPairs).values(pairs.map((x) => ({ ...x, workspaceId: ws, planId, outcomeMetric: "sell_through" as const, outcomeValue: st })));
          }
        }
        await log("outcome.logged", { type: "plan", id: planId });
      },
      /** For a plan saved before Outcomes: freezes the predictions read from its stored result, dated when it was made. */
      async freeze(planId: string, predicted: Prediction, at: Date) {
        need("outcome.log");
        await db.insert(planPredictions).values({ planId, workspaceId: ws, predicted, createdAt: at }).onConflictDoNothing();
      },
      /** Every plan with logged results, with its frozen predictions. */
      async logged() {
        need("outcome.read");
        return db
          .select({ planId: outcomes.planId, input: plans.input, outcome: outcomes, predicted: planPredictions.predicted, predictedAt: planPredictions.createdAt })
          .from(outcomes)
          .innerJoin(plans, and(eq(plans.id, outcomes.planId), eq(plans.workspaceId, ws)))
          .leftJoin(planPredictions, and(eq(planPredictions.planId, outcomes.planId), eq(planPredictions.workspaceId, ws)))
          .where(eq(outcomes.workspaceId, ws))
          .orderBy(desc(outcomes.loggedAt));
      },
      /** Every plan's frozen predictions, for labels that never read the stored plan. */
      async predictions() {
        need("outcome.read");
        return db.select({ planId: planPredictions.planId, predicted: planPredictions.predicted }).from(planPredictions).where(eq(planPredictions.workspaceId, ws));
      },
      async calibration() {
        need("outcome.read");
        return db.select().from(calibrationPairs).where(eq(calibrationPairs.workspaceId, ws)).orderBy(asc(calibrationPairs.recordedAt));
      },
    },

    /**
     * The outreach pipeline (Feature 7). Takeover never sends: a card moves to "sent" when the user
     * says they sent it, and that move keeps a copy of exactly what was sent (rule 5).
     */
    pipeline: {
      async list() {
        need("pipeline.read");
        const rows = await db
          .select({ card: outreach, ownerName: users.name, ownerEmail: users.email })
          .from(outreach)
          .leftJoin(users, eq(users.id, outreach.ownerId))
          .where(eq(outreach.workspaceId, ws))
          .orderBy(desc(outreach.movedAt), asc(outreach.id));
        return rows.map((r) => ({ ...r.card, owner: r.ownerName ?? r.ownerEmail ?? null, hash: contentHash(r.card) }));
      },
      async get(id: string) {
        need("pipeline.read");
        const card = (await db.select().from(outreach).where(and(eq(outreach.workspaceId, ws), eq(outreach.id, id))).limit(1))[0];
        if (!card) return null;
        const events = await db
          .select({ id: outreachEvents.id, fromStage: outreachEvents.fromStage, toStage: outreachEvents.toStage, sent: outreachEvents.sent, at: outreachEvents.at, actor: users.name, actorEmail: users.email })
          .from(outreachEvents)
          .leftJoin(users, eq(users.id, outreachEvents.actorId))
          .where(and(eq(outreachEvents.workspaceId, ws), eq(outreachEvents.outreachId, id)))
          .orderBy(asc(outreachEvents.at), asc(outreachEvents.id));
        return { card: { ...card, hash: contentHash(card) }, events };
      },
      /** Adds cards that are not on the board yet; returns how many were new. */
      async add(cards: NewCard[], link: { planId?: string; sponsorMatchId?: string }) {
        need("pipeline.edit");
        if (!cards.length) return 0;
        const now = new Date();
        const rows = await db
          .insert(outreach)
          .values(cards.map((c) => ({ ...c, workspaceId: ws, ownerId: ctx.userId, planId: link.planId ?? null, sponsorMatchId: link.sponsorMatchId ?? null, createdAt: now, movedAt: now })))
          .onConflictDoNothing({ target: [outreach.workspaceId, outreach.sourceKey] })
          .returning({ id: outreach.id });
        if (rows.length) {
          await db.insert(outreachEvents).values(rows.map((r) => ({ workspaceId: ws, outreachId: r.id, actorId: ctx.userId, fromStage: null, toStage: "drafted" as const, at: now })));
          await log("outreach.added", { type: link.planId ? "plan" : "sponsor_match", id: (link.planId ?? link.sponsorMatchId)! }, { cards: rows.length });
        }
        return rows.length;
      },
      async addFromPlan(planId: string) {
        const plan = await planById(planId);
        if (!plan) throw new InputError("That plan isn't in this workspace.");
        if (!plan.result.outreach?.length) throw new InputError("This plan has no outreach drafts to add.");
        return repo.pipeline.add(cardsFromPlan(planId, plan.result), { planId });
      },
      async addFromMatch(matchId: string) {
        const match = (await db.select().from(sponsorMatches).where(and(eq(sponsorMatches.workspaceId, ws), eq(sponsorMatches.id, matchId))).limit(1))[0];
        if (!match) throw new InputError("That match isn't on this workspace's shortlist.");
        return repo.pipeline.add([cardFromMatch(matchId, match.pitch)], { sponsorMatchId: matchId });
      },
      /** Edits a draft; only before it is marked sent, so the log's copy stays what was sent. */
      async edit(id: string, fields: { recipient: string; recipientEmail: string | null; subject: string; body: string }) {
        need("pipeline.edit");
        const card = (await db.select({ stage: outreach.stage }).from(outreach).where(and(eq(outreach.workspaceId, ws), eq(outreach.id, id))).limit(1))[0];
        if (!card) throw new InputError("That card isn't in this workspace.");
        if (card.stage !== "drafted") throw new InputError("Only drafts can be edited. Move it back to Drafted first.");
        await db.update(outreach).set(fields).where(and(eq(outreach.workspaceId, ws), eq(outreach.id, id)));
      },
      /**
       * Moves a card. A move to "sent" must carry the hash of the draft the user was looking at: if
       * someone changed it since, nothing is recorded and the user is asked to check it again.
       */
      async move(id: string, to: OutreachStage, seenHash?: string) {
        need("pipeline.edit");
        const card = (await db.select().from(outreach).where(and(eq(outreach.workspaceId, ws), eq(outreach.id, id))).limit(1))[0];
        if (!card) throw new InputError("That card isn't in this workspace.");
        if (card.stage === to) return;
        const now = new Date();
        const hash = contentHash(card);
        let sent = null;
        if (to === "sent") {
          if (seenHash !== hash) throw new InputError("This draft changed since you opened it. Check it, then mark it sent again.");
          sent = { recipient: card.recipient, recipientEmail: card.recipientEmail, subject: card.subject, body: card.body, contentHash: hash };
          await db.update(outreach).set({ stage: to, movedAt: now, sentBy: ctx.userId, sentAt: now, contentHash: hash }).where(and(eq(outreach.workspaceId, ws), eq(outreach.id, id)));
        } else {
          await db.update(outreach).set({ stage: to, movedAt: now }).where(and(eq(outreach.workspaceId, ws), eq(outreach.id, id)));
        }
        await db.insert(outreachEvents).values({ workspaceId: ws, outreachId: id, actorId: ctx.userId, fromStage: card.stage, toStage: to, sent, at: now });
        await log(to === "sent" ? "outreach.sent" : "outreach.moved", { type: "outreach", id }, { from: card.stage, to, recipient: card.recipient });
      },
      async remove(id: string) {
        need("pipeline.edit");
        await db.delete(outreach).where(and(eq(outreach.workspaceId, ws), eq(outreach.id, id)));
      },
    },

    /** Branded deck settings (Feature 10): every member's exports read them; admins change them. */
    branding: {
      async get() {
        return (await db.select().from(deckSettings).where(eq(deckSettings.workspaceId, ws)).limit(1))[0] ?? null;
      },
      async save(input: { bg: string; text: string; accent: string; font: DeckFont; logo: { dataUrl: string; width: number; height: number } | null }) {
        need("branding.edit");
        const values = {
          bg: input.bg,
          text: input.text,
          accent: input.accent,
          font: input.font,
          logoData: input.logo?.dataUrl ?? null,
          logoWidth: input.logo?.width ?? null,
          logoHeight: input.logo?.height ?? null,
          updatedBy: ctx.userId,
          updatedAt: new Date(),
        };
        await db.insert(deckSettings).values({ workspaceId: ws, ...values }).onConflictDoUpdate({ target: deckSettings.workspaceId, set: values });
        await log("branding.saved", { type: "workspace", id: ws });
      },
      async reset() {
        need("branding.edit");
        await db.delete(deckSettings).where(eq(deckSettings.workspaceId, ws));
        await log("branding.reset", { type: "workspace", id: ws });
      },
    },

    /** The top bar's search: names in this workspace only, a few of each kind. */
    async search(q: string) {
      need("plan.read");
      const term = `%${q.trim().replace(/[\\%_]/g, (c) => `\\${c}`).slice(0, 60)}%`;
      const [planRows, rosterRows, actRows, watchRows, dataRows, outreachRows] = await Promise.all([
        db.select({ id: plans.id, label: plans.input }).from(plans).where(and(eq(plans.workspaceId, ws), ilike(plans.input, term))).orderBy(desc(plans.createdAt)).limit(5),
        db.select({ id: rosters.id, label: rosters.name }).from(rosters).where(and(eq(rosters.workspaceId, ws), ilike(rosters.name, term))).limit(5),
        db.select({ id: rosterActs.rosterId, label: rosterActs.name }).from(rosterActs).where(and(eq(rosterActs.workspaceId, ws), ilike(rosterActs.name, term))).limit(5),
        db.select({ id: watchItems.id, label: watchItems.name, kind: watchItems.kind }).from(watchItems).where(and(eq(watchItems.workspaceId, ws), ilike(watchItems.name, term))).limit(5),
        db.select({ id: datasets.id, label: datasets.name }).from(datasets).where(and(eq(datasets.workspaceId, ws), ilike(datasets.name, term))).limit(5),
        db
          .select({ id: outreach.id, label: outreach.recipient })
          .from(outreach)
          .where(and(eq(outreach.workspaceId, ws), or(ilike(outreach.recipient, term), ilike(outreach.context, term))))
          .limit(5),
      ]);
      return [
        ...planRows.map((r) => ({ kind: "Plan", label: r.label, href: `/plan/${r.id}` })),
        ...rosterRows.map((r) => ({ kind: "Roster", label: r.label, href: `/workspace/rosters/${r.id}` })),
        ...actRows.map((r) => ({ kind: "Talent", label: r.label, href: `/workspace/rosters/${r.id}` })),
        ...watchRows.map((r) => ({ kind: r.kind === "city" ? "City" : "Watch", label: r.label, href: "/workspace/watch" })),
        ...dataRows.map((r) => ({ kind: "Data", label: r.label, href: `/workspace/data/${r.id}` })),
        ...outreachRows.map((r) => ({ kind: "Outreach", label: r.label, href: `/workspace/pipeline?card=${r.id}` })),
      ];
    },

    activity: {
      async list(limit = 50) {
        need("activity.read");
        return db
          .select({ id: activityLog.id, action: activityLog.action, targetType: activityLog.targetType, targetId: activityLog.targetId, detail: activityLog.detail, createdAt: activityLog.createdAt, actor: users.name, actorEmail: users.email })
          .from(activityLog)
          .leftJoin(users, eq(users.id, activityLog.actorId))
          .where(eq(activityLog.workspaceId, ws))
          .orderBy(desc(activityLog.createdAt))
          .limit(limit);
      },
    },
  };
  return repo;
}

export type WorkspaceRepo = ReturnType<typeof forWorkspace>;
