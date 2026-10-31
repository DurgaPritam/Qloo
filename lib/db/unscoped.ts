import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, type SQL } from "drizzle-orm";

import type { Plan } from "@/lib/agent/types";
import type { BillingChange } from "@/lib/billing/stripe";
import { billingManaged, perSeat, tierForSubscription } from "@/lib/entitlements";

import type { DB } from "./index";
import { activityLog, apiKeys, billingEvents, deckSettings, digestSubscriptions, invitations, memberships, outreach, plans, subscriptions, users, watchItems, whiteLabel, workspaces, type Role, type Visibility } from "./schema";
import { hashToken, normaliseEmail } from "./scoped";

/**
 * The only reads that cannot be scoped to a workspace in advance, because they are how a
 * workspace is found. Each is named unscoped* and returns no
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

/** For the Qloo client's counters: a workspace's tier (its allowance comes from lib/entitlements.ts). */
export async function unscopedWorkspaceTier(db: DB, workspaceId: string): Promise<{ tier: string } | null> {
  return (await db.select({ tier: workspaces.tier }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0] ?? null;
}

export type BillingOutcome = { status: "applied" | "duplicate" | "ignored"; workspaceId: string | null; tier?: string };

/**
 * Applies one Stripe event, once: the event id is recorded in the same transaction as its change,
 * so a redelivery changes nothing and a failure leaves nothing recorded (Stripe retries). The
 * workspace comes from the subscription's metadata or its Stripe customer. A workspace assigned
 * a tier by hand (Enterprise) keeps it.
 */
export async function unscopedApplyBilling(db: DB, event: { id: string; type: string }, change: BillingChange): Promise<BillingOutcome> {
  return db.transaction(async (tx) => {
    const fresh = await tx.insert(billingEvents).values({ id: event.id, type: event.type }).onConflictDoNothing().returning({ id: billingEvents.id });
    if (!fresh.length) return { status: "duplicate", workspaceId: null };
    if (change.kind === "ignore") return { status: "ignored", workspaceId: null };

    const byCustomer = (await tx.select().from(subscriptions).where(eq(subscriptions.stripeCustomerId, change.customerId)).limit(1))[0] ?? null;
    const named = "workspaceId" in change && change.workspaceId ? change.workspaceId : null;
    const workspace = named ? ((await tx.select({ id: workspaces.id, tier: workspaces.tier }).from(workspaces).where(eq(workspaces.id, named)).limit(1))[0] ?? null) : null;
    const workspaceId = workspace?.id ?? byCustomer?.workspaceId ?? null;
    if (!workspaceId) return { status: "ignored", workspaceId: null };
    await tx.update(billingEvents).set({ workspaceId }).where(eq(billingEvents.id, event.id));
    const now = new Date();

    if (change.kind === "link") {
      await tx
        .insert(subscriptions)
        .values({ workspaceId, stripeCustomerId: change.customerId })
        .onConflictDoUpdate({ target: subscriptions.workspaceId, set: { stripeCustomerId: change.customerId, updatedAt: now } });
      return { status: "applied", workspaceId };
    }
    if (change.kind === "payment_failed" || change.kind === "payment_ok") {
      await tx
        .update(subscriptions)
        .set({ paymentFailedAt: change.kind === "payment_failed" ? change.at : null, updatedAt: now })
        .where(and(eq(subscriptions.workspaceId, workspaceId), eq(subscriptions.stripeCustomerId, change.customerId)));
      return { status: "applied", workspaceId };
    }

    return applySubscription(tx, workspaceId, change);
  });
}

type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];

/** Writes a subscription's state and the tier it gives the workspace (shared by webhooks and the return sync). */
async function applySubscription(tx: Tx, workspaceId: string, change: Extract<BillingChange, { kind: "subscription" }>): Promise<BillingOutcome> {
  const now = new Date();
  const existing = (await tx.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1))[0] ?? null;
  // Stripe doesn't promise order: an older event about the same subscription never overwrites a newer one.
  if (existing?.lastEventAt && existing.stripeSubscriptionId === change.subscriptionId && existing.lastEventAt > change.eventAt) return { status: "ignored", workspaceId };
  // Another subscription ending (e.g. replaced by a new one) doesn't touch the current one.
  if (existing?.stripeSubscriptionId && existing.stripeSubscriptionId !== change.subscriptionId && change.status === "canceled") return { status: "ignored", workspaceId };
  const row = {
    stripeCustomerId: change.customerId,
    stripeSubscriptionId: change.subscriptionId,
    tier: change.tier,
    interval: change.interval,
    status: change.status,
    seats: change.seats,
    currentPeriodEnd: change.currentPeriodEnd,
    cancelAtPeriodEnd: change.cancelAtPeriodEnd,
    lastEventAt: change.eventAt,
    updatedAt: now,
  };
  await tx
    .insert(subscriptions)
    .values({ workspaceId, ...row })
    .onConflictDoUpdate({ target: subscriptions.workspaceId, set: row });

  const current = (await tx.select({ id: workspaces.id, tier: workspaces.tier }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1))[0];
  if (!current || !billingManaged(current.tier)) return { status: "applied", workspaceId, tier: current?.tier };
  const tier = tierForSubscription({ tier: change.tier, status: change.status });
  await tx
    .update(workspaces)
    .set({ tier, seats: perSeat(tier) ? change.seats : null })
    .where(eq(workspaces.id, workspaceId));
  if (tier !== current.tier) await tx.insert(activityLog).values({ workspaceId, actorId: null, action: "billing.tier", targetType: "workspace", targetId: workspaceId, detail: { from: current.tier, to: tier, status: change.status } });
  return { status: "applied", workspaceId, tier };
}

/**
 * After Checkout or the portal: the subscription as Stripe has it now, for the workspace the user
 * is in, so the plan applies before the webhook arrives. A subscription that belongs to another
 * workspace (by metadata, or a customer linked elsewhere) is refused.
 */
export async function unscopedSyncSubscription(db: DB, workspaceId: string, change: Extract<BillingChange, { kind: "subscription" }>): Promise<BillingOutcome> {
  if (change.workspaceId && change.workspaceId !== workspaceId) return { status: "ignored", workspaceId: null };
  return db.transaction(async (tx) => {
    const owner = (await tx.select({ workspaceId: subscriptions.workspaceId }).from(subscriptions).where(eq(subscriptions.stripeCustomerId, change.customerId)).limit(1))[0];
    if (owner && owner.workspaceId !== workspaceId) return { status: "ignored", workspaceId: null };
    return applySubscription(tx, workspaceId, change);
  });
}
