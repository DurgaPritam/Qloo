import { toolRequest, text } from "@/lib/server/tool-route";
import { matchBrand } from "@/lib/tools/brand";

export const maxDuration = 30;

/** POST {brand, entityId?} → the talents, shows and podcasts a brand's customers over-index on, and its cities. */
export async function POST(req: Request): Promise<Response> {
  // Search, four candidate lists and one heatmap.
  const r = await toolRequest(req, { budget: 6 });
  if ("error" in r) return r.error;
  const brand = text(r.body.brand, 100);
  if (!brand) return Response.json({ error: "Type a brand (1–100 characters).", mock: r.mock }, { status: 400 });
  try {
    return Response.json(await matchBrand(brand, text(r.body.entityId, 200) || undefined, r.source, { runId: r.runId }));
  } catch (err) {
    console.error("[api/tools/brand] failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Qloo didn't answer. Try again.", mock: r.mock }, { status: 502 });
  }
}
