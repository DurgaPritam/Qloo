import { makeBrief } from "@/lib/campaign/service";
import { createProvider } from "@/lib/llm";
import { getQlooSource } from "@/lib/qloo/source";
import { inWorkspace, readJson } from "@/lib/workspace/route";

const text = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

/**
 * POST {planId | query, entityId?, title?, flight?} → a targeting brief from a plan or a fanbase alone
 * (up to 8 Qloo calls; the model writes only the angles, from the brief's facts). DELETE ?id= removes one.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inWorkspace(async ({ repo }) => {
    const source = getQlooSource();
    const planId = text(body.planId, 40);
    const target = planId ? { planId } : { query: text(body.query, 100), entityId: text(body.entityId, 200) || undefined };
    if (!planId && !target.query) return Response.json({ error: "Pick a plan or type a fanbase." }, { status: 400 });
    const r = await makeBrief(repo, { ...target, title: text(body.title, 120) || null, flight: text(body.flight, 120) || null }, { source, model: source.mock ? null : createProvider(), now: new Date() });
    return Response.json(r.status === "done" ? { status: "done", id: r.id } : r);
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return inWorkspace(async ({ repo }) => {
    await repo.briefs.remove(id);
    return Response.json({ ok: true });
  });
}
