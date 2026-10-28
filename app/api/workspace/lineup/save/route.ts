import { InputError } from "@/lib/db/scoped";
import { lineupDraft, lineupFromDraft, type Tier } from "@/lib/tools/lineup-pool";
import { inWorkspace, readJson } from "@/lib/workspace/route";

const TIERS: Tier[] = ["A", "B", "C"];
const tier = (x: unknown): Tier => (TIERS.includes(x as Tier) ? (x as Tier) : "B");
const money = (x: unknown) => {
  const n = typeof x === "number" ? x : Number(String(x ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n >= 0 && n <= 1e9 ? Math.round(n) : 0;
};

/**
 * POST {draftId, budget, slots, fees: {A, B, C}, tiers: {actId: tier}, headlinerTier} → adds the
 * lineup the engine picks (from the draft's own Qloo fits and these numbers) to the draft's plan.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inWorkspace(async ({ repo }) => {
    const draft = await lineupDraft(typeof body.draftId === "string" ? body.draftId : "");
    if (!draft) throw new InputError("That pool has expired. Load the plan's candidates again.");
    if (!draft.planId) throw new InputError("Lineups are added to a plan: start from one of the workspace's plans.");
    const f = (body.fees ?? {}) as Record<string, unknown>;
    const given = (body.tiers ?? {}) as Record<string, unknown>;
    const yours = {
      budget: money(body.budget),
      slots: Math.min(4, Math.max(2, Number(body.slots) || 3)),
      fees: { A: money(f.A), B: money(f.B), C: money(f.C) },
      tiers: Object.fromEntries(draft.pool.map((a) => [a.id, tier(given[a.id])])),
      headlinerTier: tier(body.headlinerTier),
    };
    const lineup = lineupFromDraft(draft, yours);
    if (!lineup) throw new InputError("No lineup fits that budget at these fee tiers.");
    await repo.lineups.save(draft.planId, lineup, yours);
    return Response.json({ lineup });
  });
}
