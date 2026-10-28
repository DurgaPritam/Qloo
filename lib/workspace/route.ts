import "server-only";

import { InputError } from "@/lib/db/scoped";
import { loadPlan } from "@/lib/server/plan-store";

import { ForbiddenError } from "./permissions";
import { currentWorkspace, planForRequest } from "./session";

type Found = NonNullable<Awaited<ReturnType<typeof currentWorkspace>>>;

/** Maps repository errors to HTTP: 403 for a role, 400 for input, 500 (logged by name only) otherwise. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ForbiddenError) return Response.json({ error: "Your role in this workspace doesn't allow that." }, { status: 403 });
    if (err instanceof InputError) return Response.json({ error: err.message }, { status: 400 });
    console.error("[workspace] request failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Something went wrong. Try again." }, { status: 500 });
  }
}

/** Runs `fn` in the signed-in user's current workspace; 401 when signed out. */
export function inWorkspace(fn: (w: Found) => Promise<Response>): Promise<Response> {
  return handle(async () => {
    const found = await currentWorkspace();
    if (!found) return Response.json({ error: "Sign in first." }, { status: 401 });
    return fn(found);
  });
}

/**
 * Runs `fn` in the workspace that owns a plan, which may not be the current one (a link from
 * another workspace). 404 unless the user is a member there.
 */
export function inPlanWorkspace(planId: unknown, fn: (access: Extract<Awaited<ReturnType<typeof planForRequest>>, { kind: "member" }>) => Promise<Response>) {
  return handle(async () => {
    if (typeof planId !== "string" || !/^[0-9a-f-]{36}$/.test(planId)) return Response.json({ error: "Unknown plan." }, { status: 400 });
    const access = await planForRequest(planId, loadPlan);
    if (access?.kind !== "member") return Response.json({ error: "That plan isn't in any of your workspaces." }, { status: 404 });
    return fn(access);
  });
}

export const readJson = async (req: Request) => ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;

/** The site's public origin for links in emails: APP_URL when set, else the request's (trusted on Vercel and locally). */
export const appOrigin = (req: Request) => process.env.APP_URL?.trim().replace(/\/$/, "") || new URL(req.url).origin;
