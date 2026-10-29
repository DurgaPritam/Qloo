import "server-only";

import { cookies } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { loadPlan } from "@/lib/server/plan-store";

import {
  unscopedAcceptInvitation,
  unscopedApiKeyByHash,
  unscopedBrandByDomain,
  unscopedBrandByPublicId,
  unscopedBrandByWorkspace,
  unscopedInvitationByToken,
  unscopedReminderWorkspaces,
  unscopedUnsubscribeDigest,
  unscopedUnsubscribeReminders,
  unscopedWatchWorkspacesDue,
} from "@/lib/db/unscoped";
import { hashToken } from "@/lib/db/scoped";
import { readUnsubscribeToken } from "@/lib/watch/token";

import { contextFor, jobContext, planForViewer } from "./context";

/** The workspace switcher's choice. Only a hint: contextFor() checks the membership. */
export const WORKSPACE_COOKIE = "takeover_ws";
export const WORKSPACE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: Boolean(process.env.VERCEL_ENV),
  path: "/",
  maxAge: 365 * 24 * 60 * 60,
} as const;

/** Auth.js's database-session cookie (the __Secure- name over HTTPS). */
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
}

/** The signed-in user, or null. Never throws: a database outage reads as signed out. */
export const currentUser = cache(async (): Promise<SessionUser | null> => {
  // Request-time only: Auth.js uses random values, which must not run while prerendering.
  await connection();
  try {
    // Signed-out visitors (most traffic) never touch the database.
    const jar = await cookies();
    if (!SESSION_COOKIES.some((name) => jar.has(name))) return null;
    const session = await auth();
    const u = session?.user;
    return u?.id ? { id: u.id, email: u.email ?? null, name: u.name ?? null } : null;
  } catch (err) {
    console.error("[session] could not read the session:", err instanceof Error ? err.name : "unknown");
    return null;
  }
});

/** The signed-in user with the workspace this request acts in, and its scoped repository. */
export const currentWorkspace = cache(async () => {
  const user = await currentUser();
  if (!user) return null;
  const wanted = (await cookies()).get(WORKSPACE_COOKIE)?.value ?? null;
  const found = await contextFor(await getDb(), user.id, wanted);
  return found ? { user, ...found } : null;
});

/** /plan/<id> access for whoever is asking (see planForViewer). */
export async function planForRequest(id: string, loadAnonymous: Parameters<typeof planForViewer>[3]) {
  const user = await currentUser();
  return planForViewer(getDb, id, user?.id ?? null, loadAnonymous);
}

/**
 * Any plan by id, if whoever is asking may see it: signed-out plans, public workspace plans, and
 * workspace plans for members. Null otherwise, so callers answer as if it did not exist.
 */
export async function visiblePlan(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return (await planForRequest(id, loadPlan))?.plan ?? null;
}

/** For /invite/<token>: what the link is for (never the token or its hash). */
export async function invitationForToken(token: string) {
  // Request-time only: whether it has expired depends on the clock.
  await connection();
  return unscopedInvitationByToken(await getDb(), token);
}

/** Accepts an invitation as the signed-in user and makes that workspace current. */
export async function acceptInvitationForCurrentUser(token: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, reason: "signed-out" as const };
  const result = await unscopedAcceptInvitation(await getDb(), token, user);
  if (result.ok) (await cookies()).set(WORKSPACE_COOKIE, result.workspaceId, WORKSPACE_COOKIE_OPTIONS);
  return result;
}

/** For job routes: the workspace in the payload, checked as jobContext() describes. */
export async function jobWorkspace(workspaceId: string, userId: string) {
  return jobContext(await getDb(), workspaceId, userId);
}

/** For the weekly market watch tick: workspaces with a watch due, each with an owner to act as. */
export async function watchWorkspacesDue(now: Date) {
  return unscopedWatchWorkspacesDue(await getDb(), now);
}

/**
 * The workspace an API key belongs to, acting as the member who created it (a key stops working
 * when its creator leaves the workspace, or when it is revoked). Null for an unknown key.
 */
export async function apiKeyContext(key: string) {
  if (!/^tk_[A-Za-z0-9_-]{20,}$/.test(key)) return null;
  const db = await getDb();
  const found = await unscopedApiKeyByHash(db, hashToken(key));
  if (!found?.createdBy) return null;
  const ws = await jobContext(db, found.workspaceId, found.createdBy);
  return ws ? { ...ws, keyId: found.id, tier: found.tier } : null;
}

export type { PublicBrand } from "@/lib/db/unscoped";

/** White-label: the public branding behind a verified custom domain, a widget id, or a plan's workspace. */
export async function brandByDomain(host: string) {
  return unscopedBrandByDomain(await getDb(), host.toLowerCase());
}
export async function brandByPublicId(publicId: string) {
  return /^w_[A-Za-z0-9_-]{8,}$/.test(publicId) ? unscopedBrandByPublicId(await getDb(), publicId) : null;
}
export async function brandForWorkspace(workspaceId: string) {
  return unscopedBrandByWorkspace(await getDb(), workspaceId);
}

/**
 * A plan as anyone may see it, ignoring who is signed in: a signed-out run, or a workspace plan
 * shared publicly. Widgets and white-label pages use only this, so they never show a private plan.
 */
export async function publicPlanOnly(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const access = await planForViewer(getDb, id, null, loadPlan);
  return access && access.kind !== "member" ? access : null;
}

/** For the hourly tick: workspaces with an overdue pipeline card not yet reminded, each with an owner to act as. */
export async function reminderWorkspaces(now: Date) {
  return unscopedReminderWorkspaces(await getDb(), now);
}

/** The reminder email's unsubscribe link: a token signed for reminders only, no sign-in. */
export async function unsubscribeReminders(token: string): Promise<boolean> {
  const who = readUnsubscribeToken(token, undefined, "reminders");
  if (!who) return false;
  await unscopedUnsubscribeReminders(await getDb(), who.workspaceId, who.userId);
  return true;
}

/** The digest's unsubscribe link: a signed token for one person in one workspace, no sign-in. */
export async function unsubscribeDigest(token: string): Promise<boolean> {
  const who = readUnsubscribeToken(token);
  if (!who) return false;
  await unscopedUnsubscribeDigest(await getDb(), who.workspaceId, who.userId);
  return true;
}
