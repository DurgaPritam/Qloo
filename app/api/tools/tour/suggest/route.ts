import { CITIES } from "@/lib/engine/data";
import type { Category } from "@/lib/engine/types";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import { BudgetExceededError } from "@/lib/qloo/errors";
import { text, toolRequest } from "@/lib/server/tool-route";
import { cityById, SUGGEST_KINDS, suggestForStop, type SuggestKind } from "@/lib/tools/tour-suggest";

export const maxDuration = 30;

/**
 * POST {fanbaseId, fanbaseName?, category?, cityId, kind: "venue"|"support"|"sponsor"} → the top
 * three Qloo picks for that one stop, ranked by the engine, with their evidence. Called only when
 * the user clicks "Suggest …" on a stop: the fanbase search plus one Qloo call.
 */
export async function POST(req: Request): Promise<Response> {
  const r = await toolRequest(req, { budget: 3 });
  if ("error" in r) return r.error;
  const fanbaseId = text(r.body.fanbaseId, 200);
  const kind = text(r.body.kind, 10) as SuggestKind;
  const cityId = text(r.body.cityId, 40);
  if (!fanbaseId) return Response.json({ error: "Pick a fanbase first.", mock: r.mock }, { status: 400 });
  if (!SUGGEST_KINDS.includes(kind)) return Response.json({ error: "Ask for a venue, a support act or sponsors.", mock: r.mock }, { status: 400 });
  const city = cityById(cityId) ?? CITIES.find((c) => c.id === cityId) ?? null;
  if (!city) return Response.json({ error: "That city isn't in our city list.", mock: r.mock }, { status: 400 });
  const category = text(r.body.category, 20) as Category;
  try {
    const result = await suggestForStop(
      { fanbaseId, fanbaseName: text(r.body.fanbaseName, 100), category: FANBASE_CATEGORIES.includes(category) ? category : "artist", city, kind },
      r.source,
      { runId: r.runId },
    );
    return Response.json(result);
  } catch (err) {
    if (err instanceof BudgetExceededError) return Response.json({ error: "Qloo's call budget is used up for now. Type your own instead.", mock: r.mock }, { status: 429 });
    console.error("[api/tools/tour/suggest] failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Qloo didn't answer. Try again, or type your own.", mock: r.mock }, { status: 502 });
  }
}
