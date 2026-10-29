import { upgradeForLimit } from "@/lib/entitlements";
import { toolRequest, text } from "@/lib/server/tool-route";
import { visitorLimits } from "@/lib/workspace/gate";
import { currentWorkspace } from "@/lib/workspace/session";
import { DISTANCE_WEIGHT, optimizeFanTour, REGIONS, saveTourDraft } from "@/lib/tools/tour";

export const maxDuration = 30;

const names = (v: unknown) => (Array.isArray(v) ? v.slice(0, 10).map((x) => text(x, 80)).filter(Boolean) : []);

/**
 * POST {fanbase, entityId?, region?, stops?, maxLegKm?, start?, end?, include?, exclude?, distanceWeight?} → the best
 * route through the fanbase's strongest cities inside those constraints, with "why not" for strong
 * cities left out. Search plus one heatmap per country (up to five).
 */
export async function POST(req: Request): Promise<Response> {
  const r = await toolRequest(req, { budget: 6 });
  if ("error" in r) return r.error;
  const fanbase = text(r.body.fanbase);
  if (!fanbase) return Response.json({ error: "Type a fanbase (1–100 characters).", mock: r.mock }, { status: 400 });
  const stops = Number(r.body.stops);
  // Stops follow the visitor's plan (lib/entitlements.ts): Free when signed out.
  const plan = await visitorLimits(await currentWorkspace().catch(() => null));
  if (Number.isInteger(stops) && stops > plan.limits.tourStops) {
    const upgrade = upgradeForLimit(plan.tier, "tourStops", `Your plan routes tours of up to ${plan.limits.tourStops} stops.`);
    return Response.json({ error: `${upgrade?.reason ?? ""} ${upgrade ? `${upgrade.label} raises it.` : ""}`.trim(), code: "upgrade_required", upgrade, mock: r.mock }, { status: 402 });
  }
  const maxLeg = Number(r.body.maxLegKm);
  const region = text(r.body.region, 20);
  const weight = Number(r.body.distanceWeight);
  try {
    const result = await optimizeFanTour(
        fanbase,
        text(r.body.entityId, 200) || undefined,
        {
          region: REGIONS[region] ? region : region.toUpperCase() || undefined,
          stops: Number.isInteger(stops) && stops >= 2 && stops <= 12 ? stops : 6,
          maxLegKm: Number.isFinite(maxLeg) && maxLeg >= 50 && maxLeg <= 20_000 ? Math.round(maxLeg) : null,
          start: text(r.body.start, 80) || undefined,
          end: text(r.body.end, 80) || undefined,
          include: names(r.body.include),
          exclude: names(r.body.exclude),
          ...(r.body.distanceWeight !== undefined && Number.isFinite(weight) && weight >= DISTANCE_WEIGHT.min && weight <= DISTANCE_WEIGHT.max ? { distanceWeight: weight } : {}),
        },
        r.source,
        { runId: r.runId },
      );
    // A finished tour is kept for a day so a signed-in user can save exactly this result.
    return Response.json(result.status === "done" && !result.route.infeasible ? { ...result, draftId: await saveTourDraft(result) } : result);
  } catch (err) {
    console.error("[api/tools/tour] failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Qloo didn't answer. Try again.", mock: r.mock }, { status: 502 });
  }
}
