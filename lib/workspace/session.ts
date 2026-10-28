import "server-only";

import { cookies } from "next/headers";
import { connection } from "next/server";
import { cache } from "react";

import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { loadPlan } from "@/lib/server/plan-store";

import { unscopedAcceptInvitation, unscopedInvitationByToken } from "@/lib/db/unscoped";

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
