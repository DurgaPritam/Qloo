import { cityInfo, metricByCity, planCityScores } from "@/lib/data/service";
import type { RankingData } from "@/lib/data/types";
import { inPlanWorkspace } from "@/lib/workspace/route";

/**
 * GET ?planId= → the plan's city scores with the workspace's own data for its fanbase, for the
 * three columns in the city step. Members of the plan's workspace only; a public viewer of the
 * same plan gets 404, so user data never leaves the workspace.
 */
export async function GET(req: Request): Promise<Response> {
  const planId = new URL(req.url).searchParams.get("planId");
  return inPlanWorkspace(planId, async ({ repo, plan }) => {
    const fanbase = plan.fanbase;
    const dataset = fanbase ? await repo.datasets.forEntity(fanbase.id) : null;
    if (!fanbase || !dataset) return Response.json({ dataset: null });
    const rows = await repo.datasets.rows(dataset.id);
    const qloo = planCityScores(plan);
    const totals = Object.fromEntries(dataset.metrics.map((m) => [m.key, metricByCity(rows, m.key)]));
    const ranking: RankingData = {
      qloo,
      qlooLabel: "Both audiences' heat",
      metrics: dataset.metrics.map((m) => ({ key: m.key, label: m.label })),
      totals,
      cities: cityInfo([...qloo.map((q) => q.cityId), ...Object.values(totals).flatMap((t) => t.map((x) => x.cityId))]),
    };
    return Response.json({ dataset: { id: dataset.id, name: dataset.name }, ranking });
  });
}
