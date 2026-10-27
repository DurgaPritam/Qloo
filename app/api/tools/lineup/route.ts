import { toolRequest, text } from "@/lib/server/tool-route";
import { suggestLineup } from "@/lib/tools/lineup";

export const maxDuration = 30;

/** POST {headliner, entityId?} → support acts, hosts, city and venue for a lineup (5 Qloo calls). */
export async function POST(req: Request): Promise<Response> {
  const r = await toolRequest(req, { budget: 5 });
  if ("error" in r) return r.error;
  const headliner = text(r.body.headliner);
  if (!headliner) return Response.json({ error: "Type a headliner (1–100 characters).", mock: r.mock }, { status: 400 });
  try {
    return Response.json(await suggestLineup(headliner, text(r.body.entityId, 200) || undefined, r.source, { runId: r.runId }));
  } catch (err) {
    console.error("[api/tools/lineup] failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Qloo didn't answer. Try again.", mock: r.mock }, { status: 502 });
  }
}
