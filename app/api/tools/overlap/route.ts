import { toolRequest, text } from "@/lib/server/tool-route";
import { PAIR_SEP, recordTrend } from "@/lib/server/trending";
import { checkOverlap } from "@/lib/tools/overlap";

export const maxDuration = 30;

/** POST {a, b, aId?, bId?} → how much two fanbases overlap, where, and who the fans are. */
export async function POST(req: Request): Promise<Response> {
  // Two searches, two affinities, two heatmaps, two demographics.
  const r = await toolRequest(req, { budget: 8 });
  if ("error" in r) return r.error;
  const a = text(r.body.a);
  const b = text(r.body.b);
  if (!a || !b) return Response.json({ error: "Type two names (1–100 characters each).", mock: r.mock }, { status: 400 });
  try {
    const ids = { a: text(r.body.aId, 200) || undefined, b: text(r.body.bId, 200) || undefined };
    const result = await checkOverlap(a, b, ids, r.source, { runId: r.runId });
    if (result.status === "done" && !result.mock) await recordTrend("pair", `${result.a.name}${PAIR_SEP}${result.b.name}`);
    return Response.json(result);
  } catch (err) {
    console.error("[api/tools/overlap] failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Qloo didn't answer. Try again.", mock: r.mock }, { status: 502 });
  }
}
