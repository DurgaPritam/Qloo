import { InputError } from "@/lib/db/scoped";
import { getQlooSource } from "@/lib/qloo/source";
import { withBudget } from "@/lib/agent/budget";
import { lineupPool } from "@/lib/tools/lineup-pool";
import { can, ForbiddenError } from "@/lib/workspace/permissions";
import { inWorkspace, readJson } from "@/lib/workspace/route";

const text = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

/** Calls a pool can use: a search for a typed headliner, then two candidate lists. */
const POOL_CALLS = 4;

/**
 * GET ?planId= → the plan's saved lineup, if any. POST {planId} or {query, entityId?} → a candidate
 * pool for the headliner (its fans' affinities, up to 4 Qloo calls), kept as a draft for a day.
 */
export async function GET(req: Request): Promise<Response> {
  const planId = new URL(req.url).searchParams.get("planId") ?? "";
  return inWorkspace(async ({ repo }) => Response.json({ lineup: /^[0-9a-f-]{36}$/.test(planId) ? await repo.lineups.get(planId) : null }));
}

export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inWorkspace(async ({ repo, ctx }) => {
    if (!can(ctx.role, "plan.create")) throw new ForbiddenError("plan.create");
    const runId = `lineup-${crypto.randomUUID()}`;
    const source = withBudget(getQlooSource(), runId, POOL_CALLS);
    const opts = { runId, scope: { kind: "workspace" as const, workspaceId: ctx.workspaceId } };
    const planId = text(body.planId, 40);
    if (planId) {
      const plan = (await repo.plans.get(planId))?.result;
      if (!plan?.fanbase) throw new InputError("Pick a plan with a fanbase.");
      return Response.json(await lineupPool({ entity: plan.fanbase }, { planId, city: plan.room?.cityName ?? null }, source, opts));
    }
    const query = text(body.query, 100);
    if (!query) throw new InputError("Pick a plan or type a headliner.");
    return Response.json(await lineupPool({ query, entityId: text(body.entityId, 200) || undefined }, { planId: null, city: null }, source, opts));
  });
}
