import { TIERS, type Tier } from "@/lib/engine/lineup";
import { text } from "@/lib/server/tool-route";
import { savePoster } from "@/lib/tools/lineup";

/** POST {draftId, actIds, tiers, title?} → a saved poster of the bill, scored from the draft's own Qloo matrix. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const draftId = text(body?.draftId, 64);
  const actIds = Array.isArray(body?.actIds) ? body.actIds.filter((v): v is string => typeof v === "string").slice(0, 10) : [];
  const given = (body?.tiers ?? {}) as Record<string, unknown>;
  const tiers = Object.fromEntries(Object.entries(given).filter(([, t]) => (TIERS as unknown[]).includes(t))) as Record<string, Tier>;
  if (!draftId || actIds.length < 2) return Response.json({ error: "Pick at least two acts." }, { status: 400 });
  const saved = await savePoster(draftId, actIds, tiers, text(body?.title, 60));
  if ("error" in saved) return Response.json(saved, { status: 400 });
  return Response.json(saved);
}
