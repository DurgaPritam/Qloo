import "server-only";

import type { Plan } from "@/lib/agent/types";
import type { DB } from "@/lib/db";
import { forWorkspace, type WorkspaceContext, type WorkspaceRepo } from "@/lib/db/scoped";
import type { Role } from "@/lib/db/schema";
import { unscopedMembershipsOf, unscopedPlanAccess } from "@/lib/db/unscoped";

export type Membership = { workspaceId: string; name: string; personal: boolean; role: Role };

/**
 * The workspace a request acts in: the one asked for (the switcher's cookie) if the user is a
 * member, else their personal workspace, else their first. Null when they belong to none.
 */
export async function contextFor(
  db: DB,
  userId: string,
  wanted?: string | null,
): Promise<{ ctx: WorkspaceContext; repo: WorkspaceRepo; memberships: Membership[] } | null> {
  const memberships = await unscopedMembershipsOf(db, userId);
  const pick = memberships.find((m) => m.workspaceId === wanted) ?? memberships.find((m) => m.personal) ?? memberships[0];
  if (!pick) return null;
  const ctx = { userId, workspaceId: pick.workspaceId, role: pick.role };
  return { ctx, repo: forWorkspace(db, ctx), memberships };
}

export type PlanAccess =
  | { kind: "anonymous"; plan: Plan }
  | { kind: "public"; plan: Plan; workspaceId: string }
  | { kind: "member"; plan: Plan; workspaceId: string; repo: WorkspaceRepo; role: Role; createdBy: string | null; visibility: "workspace" | "public" };

/**
 * Who may see /plan/<id>. Workspace plans: members always, everyone else only when the plan is
 * public. Plans made signed-out (in the Redis store) stay public, as before. Anything else is
 * null, and the page answers 404, so a private plan's existence is not revealed.
 */
export async function planForViewer(
  dbOrOpen: DB | (() => Promise<DB>),
  id: string,
  userId: string | null,
  loadAnonymous: (id: string) => Promise<Plan | null>,
): Promise<PlanAccess | null> {
  // Signed-out plans first: workspace plans never enter that store (their ids are always new),
  // so a hit there is public, and most share links never touch the database.
  const anonymous = await loadAnonymous(id);
  if (anonymous) return { kind: "anonymous", plan: anonymous };
  const db = typeof dbOrOpen === "function" ? await dbOrOpen() : dbOrOpen;
  const access = await unscopedPlanAccess(db, id);
  if (!access) return null;
  if (userId) {
    const membership = (await unscopedMembershipsOf(db, userId)).find((m) => m.workspaceId === access.workspaceId);
    if (membership) {
      const repo = forWorkspace(db, { userId, workspaceId: access.workspaceId, role: membership.role });
      const row = await repo.plans.get(id);
      if (row) return { kind: "member", plan: row.result, workspaceId: access.workspaceId, repo, role: membership.role, createdBy: row.createdBy, visibility: row.visibility };
    }
  }
  return access.publicPlan ? { kind: "public", plan: access.publicPlan, workspaceId: access.workspaceId } : null;
}

/** Copies the given browser-saved plans (by run id) into the workspace; ones no longer stored are counted as missing. */
export async function importBrowserPlans(repo: WorkspaceRepo, runIds: readonly string[], load: (id: string) => Promise<Plan | null>) {
  const unique = [...new Set(runIds)].slice(0, 50);
  const found = (await Promise.all(unique.map((id) => load(id)))).filter((p): p is Plan => Boolean(p && p.status === "complete"));
  const result = await repo.plans.importFromBrowser(found);
  return { ...result, missing: unique.length - found.length };
}
