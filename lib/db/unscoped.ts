import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, type SQL } from "drizzle-orm";

import type { Plan } from "@/lib/agent/types";

import type { DB } from "./index";
import { activityLog, apiKeys, deckSettings, digestSubscriptions, invitations, memberships, outreach, plans, users, watchItems, whiteLabel, workspaces, type Role, type Visibility } from "./schema";
import { hashToken, normaliseEmail } from "./scoped";

/**
 * The only reads that cannot be scoped to a workspace in advance, because they are how a
 * workspace is found (docs/roadmap-rules.md, rule 3). Each is named unscoped* and returns no
 * more than its caller needs. Writes here still carry workspace_id.
 */

/** The signed-in user's own memberships: how the workspace for a request is chosen. */
export function unscopedMembershipsOf(db: DB, userId: string) {
  return db
    .select({ workspaceId: workspaces.id, name: workspaces.name, personal: workspaces.personal, role: memberships.role })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(memberships.createdAt));
}

/**
 * For /plan/<id>: which workspace owns a plan and whether it is public. The plan itself is
 * returned only when it is public; members read it through forWorkspace().
 */
export async function unscopedPlanAccess(db: DB, id: string): Promise<{ workspaceId: string; visibility: Visibility; publicPlan: Plan | null } | null> {
  const row = (await db.select({ workspaceId: plans.workspaceId, visibility: plans.visibility, result: plans.result }).from(plans).where(eq(plans.id, id)).limit(1))[0];
  if (!row) return null;
  return { workspaceId: row.workspaceId, visibility: row.visibility, publicPlan: row.visibility === "public" ? row.result : null };
}

export type InvitationView = {
  id: string;
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: Exclude<Role, "owner">;
  inviter: string | null;
  state: "pending" | "accepted" | "revoked" | "expired";
};

/** For /invite/<token>: the invitation the link stands for. */
export async function unscopedInvitationByToken(db: DB, token: string): Promise<InvitationView | null> {
  if (!token || token.length > 200) return null;
  const row = (
    await db
      .select({
        id: invitations.id,
        workspaceId: invitations.workspaceId,
        workspaceName: workspaces.name,
        email: invitations.email,
        role: invitations.role,
        inviter: users.name,
        inviterEmail: users.email,
        acceptedAt: invitations.acceptedAt,
        revokedAt: invitations.revokedAt,
        expiresAt: invitations.expiresAt,
      })
      .from(invitations)
      .innerJoin(workspaces, eq(workspaces.id, invitations.workspaceId))
      .leftJoin(users, eq(users.id, invitations.invitedBy))
      .where(eq(invitations.tokenHash, hashToken(token)))
      .limit(1)
  )[0];
  if (!row) return null;
  const state = row.acceptedAt ? "accepted" : row.revokedAt ? "revoked" : row.expiresAt.getTime() < Date.now() ? "expired" : "pending";
  return { id: row.id, workspaceId: row.workspaceId, workspaceName: row.workspaceName, email: row.email, role: row.role, inviter: row.inviter ?? row.inviterEmail, state };
}

export type AcceptResult =
  | { ok: true; workspaceId: string }
  | { ok: false; reason: "not-found" | "accepted" | "revoked" | "expired" | "wrong-email" };

/** Accepts an invitation for the signed-in user, whose email must match the invited one. */
export async function unscopedAcceptInvitation(db: DB, token: string, user: { id: string; email: string | null | undefined }): Promise<AcceptResult> {
  const invite = await unscopedInvitationByToken(db, token);
  if (!invite) return { ok: false, reason: "not-found" };
  if (invite.state !== "pending") {
    // Accepting twice is fine for the person it was for.
    if (invite.state === "accepted") {
      const member = await db
        .select({ role: memberships.role })
        .from(memberships)
        .where(and(eq(memberships.workspaceId, invite.workspaceId), eq(memberships.userId, user.id)))
        .limit(1);
      if (member.length) return { ok: true, workspaceId: invite.workspaceId };
    }
    return { ok: false, reason: invite.state };
  }
  if (!user.email || normaliseEmail(user.email) !== invite.email) return { ok: false, reason: "wrong-email" };
  await db.transaction(async (tx) => {
    await tx
      .insert(memberships)
      .values({ workspaceId: invite.workspaceId, userId: user.id, role: invite.role })
      .onConflictDoNothing();
    await tx
      .update(invitations)
      .set({ acceptedAt: new Date(), acceptedBy: user.id })
      .where(and(eq(invitations.workspaceId, invite.workspaceId), eq(invitations.id, invite.id)));
    await tx.insert(activityLog).values({ workspaceId: invite.workspaceId, actorId: user.id, action: "member.joined", targetType: "user", targetId: user.id, detail: { role: invite.role } });
  });
  return { ok: true, workspaceId: invite.workspaceId };
}

/** On first sign-in: a personal workspace the user owns. Idempotent. */
export async function unscopedEnsurePersonalWorkspace(db: DB, user: { id: string; name?: string | null; email?: string | null }): Promise<string> {
  const mine = await unscopedMembershipsOf(db, user.id);
  const personal = mine.find((m) => m.personal && m.role === "owner");
  if (personal) return personal.workspaceId;
  const who = user.name?.trim() || user.email?.split("@")[0] || "My";
  const id = crypto.randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(workspaces).values({ id, name: `${who}'s workspace`.slice(0, 60), personal: true, createdBy: user.id });
    await tx.insert(memberships).values({ workspaceId: id, userId: user.id, role: "owner" });
    await tx.insert(activityLog).values({ workspaceId: id, actorId: user.id, action: "workspace.created", targetType: "workspace", targetId: id });
  });
  return id;
}

/**
 * For the weekly market watch tick: the workspaces with a watch item due, each with a member to
 * act as (its earliest owner). The job then works through forWorkspace() only.
 */
export async function unscopedWatchWorkspacesDue(db: DB, now: Date): Promise<{ workspaceId: string; userId: string; timeZone: string | null }[]> {
  const due = await db
    .selectDistinct({ workspaceId: watchItems.workspaceId })
    .from(watchItems)
    .where(or(isNull(watchItems.nextDueAt), lte(watchItems.nextDueAt, now)));
  if (!due.length) return [];
  const owners = await db
    .select({ workspaceId: memberships.workspaceId, userId: memberships.userId, createdAt: memberships.createdAt })
    .from(memberships)
    .where(and(inArray(memberships.workspaceId, due.map((d) => d.workspaceId)), eq(memberships.role, "owner")))
    .orderBy(asc(memberships.createdAt));
  const first = new Map<string, string>();
  for (const o of owners) if (!first.has(o.workspaceId)) first.set(o.workspaceId, o.userId);
  const zones = new Map(
    (await db.select({ id: workspaces.id, timeZone: workspaces.timeZone }).from(workspaces).where(inArray(workspaces.id, [...first.keys()]))).map((w) => [w.id, w.timeZone]),
  );
  return [...first].map(([workspaceId, userId]) => ({ workspaceId, userId, timeZone: zones.get(workspaceId) ?? null }));
}

/** For the digest's unsubscribe link (no sign-in): turns that person's digest off in that workspace. */
export async function unscopedUnsubscribeDigest(db: DB, workspaceId: string, userId: string): Promise<boolean> {
  const done = await db
    .update(digestSubscriptions)
    .set({ enabled: false, updatedAt: new Date() })
    .where(and(eq(digestSubscriptions.workspaceId, workspaceId), eq(digestSubscriptions.userId, userId)))
    .returning({ userId: digestSubscriptions.userId });
  return done.length > 0;
}

/**
 * For the hourly tick: workspaces with a pipeline card past its due date (by UTC tomorrow, so every
 * time zone is covered; the job checks the workspace's own date) that has not reminded yet, each
 * with an owner to act as.
 */
export async function unscopedReminderWorkspaces(db: DB, now: Date): Promise<{ workspaceId: string; userId: string }[]> {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const due = await db
    .selectDistinct({ workspaceId: outreach.workspaceId })
    .from(outreach)
    .where(and(lt(outreach.dueDate, tomorrow), notInArray(outreach.stage, ["booked", "lost"]), or(isNull(outreach.remindedFor), ne(outreach.remindedFor, outreach.dueDate))));
  if (!due.length) return [];
  const owners = await db
    .select({ workspaceId: memberships.workspaceId, userId: memberships.userId })
    .from(memberships)
    .where(and(inArray(memberships.workspaceId, due.map((d) => d.workspaceId)), eq(memberships.role, "owner")))
    .orderBy(asc(memberships.createdAt));
  const first = new Map<string, string>();
  for (const o of owners) if (!first.has(o.workspaceId)) first.set(o.workspaceId, o.userId);
  return [...first].map(([workspaceId, userId]) => ({ workspaceId, userId }));
}

/** For the reminder email's unsubscribe link (no sign-in): turns that person's reminder emails off. */
export async function unscopedUnsubscribeReminders(db: DB, workspaceId: string, userId: string): Promise<boolean> {
  const done = await db
    .update(digestSubscriptions)
    .set({ remindersEnabled: false, updatedAt: new Date() })
    .where(and(eq(digestSubscriptions.workspaceId, workspaceId), eq(digestSubscriptions.userId, userId)))
    .returning({ userId: digestSubscriptions.userId });
  return done.length > 0;
}

/**
 * For the public API: the key with this hash, its workspace and tier, when it has not been revoked.
 * The request then works through `forWorkspace` as the key's creator.
 */
export async function unscopedApiKeyByHash(db: DB, hash: string): Promise<{ id: string; workspaceId: string; createdBy: string | null; tier: string } | null> {
  const row = (
    await db
      .select({ id: apiKeys.id, workspaceId: apiKeys.workspaceId, createdBy: apiKeys.createdBy, tier: workspaces.tier })
      .from(apiKeys)
      .innerJoin(workspaces, eq(workspaces.id, apiKeys.workspaceId))
      .where(and(eq(apiKeys.hash, hash), isNull(apiKeys.revokedAt)))
      .limit(1)
  )[0];
  return row ?? null;
}

export interface PublicBrand {
  workspaceId: string;
  name: string;
  tier: string;
  /** Null until white-label settings are opened (no widget id yet). */
  publicId: string | null;
  domain: string | null;
  verified: boolean;
  embedOrigins: string[];
  branding: { bg: string; text: string; accent: string; font: string; logoData: string | null } | null;
}

async function publicBrand(db: DB, where: SQL): Promise<PublicBrand | null> {
  const row = (
    await db
      .select({ id: workspaces.id, name: workspaces.name, tier: workspaces.tier, wl: whiteLabel, deck: deckSettings })
      .from(workspaces)
      .leftJoin(whiteLabel, eq(whiteLabel.workspaceId, workspaces.id))
      .leftJoin(deckSettings, eq(deckSettings.workspaceId, workspaces.id))
      .where(where)
      .limit(1)
  )[0];
  if (!row) return null;
  return {
    workspaceId: row.id,
    name: row.name,
    tier: row.tier,
    publicId: row.wl?.publicId ?? null,
    domain: row.wl?.domain ?? null,
    verified: Boolean(row.wl?.domainVerifiedAt),
    embedOrigins: row.wl?.embedOrigins ?? [],
    branding: row.deck ? { bg: row.deck.bg, text: row.deck.text, accent: row.deck.accent, font: row.deck.font, logoData: row.deck.logoData } : null,
  };
}

/** For a request on a custom domain: the workspace whose verified domain it is, and its public branding only. */
export const unscopedBrandByDomain = (db: DB, host: string) => publicBrand(db, and(eq(whiteLabel.domain, host), isNotNull(whiteLabel.domainVerifiedAt))!);
/** For a widget: the workspace behind a public widget id, and its public branding only. */
export const unscopedBrandByPublicId = (db: DB, publicId: string) => publicBrand(db, eq(whiteLabel.publicId, publicId));
/** For a shared plan: the plan's workspace's public branding, when it has white-label settings. */
export const unscopedBrandByWorkspace = (db: DB, workspaceId: string) => publicBrand(db, eq(workspaces.id, workspaceId));
