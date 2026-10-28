import "server-only";

import { and, asc, eq } from "drizzle-orm";

import type { Plan } from "@/lib/agent/types";

import type { DB } from "./index";
import { activityLog, invitations, memberships, plans, users, workspaces, type Role, type Visibility } from "./schema";
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
