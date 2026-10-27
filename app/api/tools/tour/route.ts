import { toolRequest, text } from "@/lib/server/tool-route";
import { planFanTour } from "@/lib/tools/tour";

export const maxDuration = 30;

/** POST {fanbase, entityId?, country?, stops?} → a tour route through the fanbase's strongest cities. */
export async function POST(req: Request): Promise<Response> {
  const r = await toolRequest(req, { budget: 2 });
  if ("error" in r) return r.error;
  const fanbase = text(r.body.fanbase);
  if (!fanbase) return Response.json({ error: "Type a fanbase (1–100 characters).", mock: r.mock }, { status: 400 });
  const stops = Number(r.body.stops);
  try {
    return Response.json(
      await planFanTour(
        fanbase,
        text(r.body.entityId, 200) || undefined,
        text(r.body.country, 2).toUpperCase() || undefined,
        Number.isInteger(stops) && stops >= 3 && stops <= 8 ? stops : undefined,
        r.source,
        { runId: r.runId },
      ),
    );
  } catch (err) {
    console.error("[api/tools/tour] failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Qloo didn't answer. Try again.", mock: r.mock }, { status: 502 });
  }
}
