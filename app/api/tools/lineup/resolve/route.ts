import { toolRequest, text } from "@/lib/server/tool-route";
import { MAX_POOL, resolveActs } from "@/lib/tools/lineup";

export const maxDuration = 30;

/** POST {acts: [{name, entityId?}]} → each name matched with Qloo (one search per name, up to 10). */
export async function POST(req: Request): Promise<Response> {
  const r = await toolRequest(req, { budget: MAX_POOL });
  if ("error" in r) return r.error;
  const acts = (Array.isArray(r.body.acts) ? r.body.acts : [])
    .slice(0, MAX_POOL)
    .map((a) => ({ name: text((a as Record<string, unknown>)?.name), entityId: text((a as Record<string, unknown>)?.entityId, 200) || undefined }))
    .filter((a) => a.name);
  if (!acts.length) return Response.json({ error: "Add at least one act.", mock: r.mock }, { status: 400 });
  try {
    return Response.json({ acts: await resolveActs(acts, r.source, { runId: r.runId }), mock: r.mock });
  } catch (err) {
    console.error("[api/tools/lineup/resolve] failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Qloo didn't answer. Try again.", mock: r.mock }, { status: 502 });
  }
}
