import { resolveCityName } from "@/lib/itinerary/ai-edit";

/**
 * GET ?q=<typed city> → {status: "matched", city} | {status: "ambiguous", options} | {status: "unmatched"}:
 * the Tour planner's "Add a stop", matched against the city list (no Qloo call, no model).
 */
export async function GET(req: Request): Promise<Response> {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  if (!q || q.length > 100) return Response.json({ error: "Type a city (1–100 characters)." }, { status: 400 });
  return Response.json(resolveCityName(q));
}
