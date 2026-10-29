import "server-only";

import { InputError } from "@/lib/db/scoped";
import type { Feature } from "@/lib/entitlements";
import { loadPlan } from "@/lib/server/plan-store";

import { needFeature, UpgradeRequiredError } from "./gate";
import { ForbiddenError } from "./permissions";
import { currentWorkspace, planForRequest } from "./session";

type Found = NonNullable<Awaited<ReturnType<typeof currentWorkspace>>>;

/** Maps repository errors to HTTP: 403 for a role, 400 for input, 500 (logged by name only) otherwise. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof UpgradeRequiredError) {
      const how = err.upgrade.selfServe ? `Upgrade to ${err.upgrade.label} in Settings → Plans & billing.` : `${err.upgrade.label} is set up with us: Settings → Plans & billing → Contact us.`;
      return Response.json({ error: `${err.message} ${how}`, code: "upgrade_required", upgrade: err.upgrade }, { status: 402 });
    }
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
 * Runs `fn` in the current workspace when its tier includes `feature` (lib/entitlements.ts);
 * otherwise 402 with the upgrade that unlocks it. Used for writes and anything that spends Qloo
 * calls; reads of stored data stay open, so a downgrade leaves data read-only.
 */
export function inFeature(feature: Feature, fn: (w: Found) => Promise<Response>): Promise<Response> {
  return inWorkspace(async (w) => {
    await needFeature(w.repo, feature);
    return fn(w);
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

const UUID = /^[0-9a-f-]{36}$/;

/** Runs `fn` with a roster of the current workspace; 404 when it is not one of them. */
export function inRoster(id: string, fn: (w: Found, roster: NonNullable<Awaited<ReturnType<Found["repo"]["rosters"]["get"]>>>) => Promise<Response>) {
  return inWorkspace(async (w) => {
    const roster = UUID.test(id) ? await w.repo.rosters.get(id) : null;
    if (!roster) return Response.json({ error: "That roster isn't in this workspace." }, { status: 404 });
    return fn(w, roster);
  });
}

/** Runs `fn` with a dataset of the current workspace; 404 when it is not one of them. */
export function inDataset(id: string, fn: (w: Found, dataset: NonNullable<Awaited<ReturnType<Found["repo"]["datasets"]["get"]>>>) => Promise<Response>) {
  return inWorkspace(async (w) => {
    const dataset = UUID.test(id) ? await w.repo.datasets.get(id) : null;
    if (!dataset) return Response.json({ error: "That dataset isn't in this workspace." }, { status: 404 });
    return fn(w, dataset);
  });
}
