import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, asc, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";

import type { ActProfile, CallRecord, RosterEntity } from "@/lib/roster/types";

import type { Plan } from "@/lib/agent/types";
import { mentionedUserIds } from "@/lib/workspace/mentions";
import { assignableRoles, can, canManage, ForbiddenError, type Action } from "@/lib/workspace/permissions";
import { isPlanTarget } from "@/lib/workspace/targets";

import type { DB } from "./index";
import {
  activityLog,
  comments,
  entityProfiles,
  invitations,
  jobRuns,
  memberships,
  notifications,
  plans,
  rosterActs,
  rosters,
  users,
  workspaces,
  type CommentTarget,
  type JobStatus,
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
          await db.insert(plans).values(
            fresh.map((p) => {
              const id = crypto.randomUUID();
              return { id, workspaceId: ws, createdBy: ctx.userId, input: p.query, result: { ...p, runId: id }, importedFrom: p.runId };
            }),
          );
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
      async create(input: { kind: "roster.refresh"; targetId: string; status: JobStatus; payload?: Record<string, unknown>; note?: string }) {
        need("roster.edit");
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
