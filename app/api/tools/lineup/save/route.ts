import { text } from "@/lib/server/tool-route";
import { saveLineup } from "@/lib/tools/lineup";

/** POST {draftId, actIds, hostId?, title?} → a saved poster built only from the draft's suggestions. */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const draftId = text(body?.draftId, 64);
  const actIds = Array.isArray(body?.actIds) ? body.actIds.filter((v): v is string => typeof v === "string").slice(0, 4) : [];
  const hostId = text(body?.hostId, 200) || null;
  if (!draftId || !actIds.length) return Response.json({ error: "Pick at least one support act." }, { status: 400 });
  const saved = await saveLineup(draftId, actIds, hostId, text(body?.title, 60));
  if ("error" in saved) return Response.json(saved, { status: 400 });
  return Response.json(saved);
}
