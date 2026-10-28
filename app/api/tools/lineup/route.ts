import type { Category } from "@/lib/engine/types";
import { toolRequest, text } from "@/lib/server/tool-route";
import { MAX_POOL, scorePool } from "@/lib/tools/lineup";

export const maxDuration = 30;

/**
 * POST {acts: [{id, name, category}]} (2–10 acts, matched with Qloo) → the pool's pairwise Qloo
 * affinities as a draft: one call per act and category, at most 20.
 */
export async function POST(req: Request): Promise<Response> {
  const r = await toolRequest(req, { budget: MAX_POOL * 2 });
  if ("error" in r) return r.error;
  const acts = (Array.isArray(r.body.acts) ? r.body.acts : [])
    .slice(0, MAX_POOL)
    .map((a) => {
      const x = a as Record<string, unknown>;
      return { id: text(x?.id, 200), name: text(x?.name), category: text(x?.category, 20) as Category };
    })
    .filter((a) => a.id && a.name && a.category);
  if (acts.length < 2) return Response.json({ error: "Add at least two acts.", mock: r.mock }, { status: 400 });
  try {
    return Response.json(await scorePool(acts, r.source, { runId: r.runId }));
  } catch (err) {
    console.error("[api/tools/lineup] failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Qloo didn't answer. Try again.", mock: r.mock }, { status: 502 });
  }
}
