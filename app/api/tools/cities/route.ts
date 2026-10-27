import { toolRequest, text } from "@/lib/server/tool-route";
import { exploreCities } from "@/lib/tools/cities";

export const maxDuration = 30;

/** POST {fanbase, entityId?} → where that fanbase is strongest, in up to four markets. */
export async function POST(req: Request): Promise<Response> {
  // Search and four heatmaps.
  const r = await toolRequest(req, { budget: 5 });
  if ("error" in r) return r.error;
  const fanbase = text(r.body.fanbase, 100);
  if (!fanbase) return Response.json({ error: "Type a fanbase (1–100 characters).", mock: r.mock }, { status: 400 });
  try {
    return Response.json(await exploreCities(fanbase, text(r.body.entityId, 200) || undefined, r.source, { runId: r.runId }));
  } catch (err) {
    console.error("[api/tools/cities] failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Qloo didn't answer. Try again.", mock: r.mock }, { status: 502 });
  }
}
