import { makeBrief } from "@/lib/campaign/service";
import { createProvider } from "@/lib/llm";
import { getQlooSource } from "@/lib/qloo/source";
import { inWorkspace, readJson } from "@/lib/workspace/route";

const text = (x: unknown, max: number) => (typeof x === "string" ? x.trim().slice(0, max) : "");

/**
 * POST {planId, title?, flight?, budget?} → a campaign brief from one of the workspace's plans (up to
 * 2 Qloo calls for demographics; the model only rephrases angles). DELETE ?id= removes one.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inWorkspace(async ({ repo }) => {
    const source = getQlooSource();
    const r = await makeBrief(
      repo,
      { planId: text(body.planId, 40), title: text(body.title, 120) || null, flight: text(body.flight, 120) || null, budget: text(body.budget, 120) || null },
      { source, model: source.mock ? null : createProvider(), now: new Date() },
    );
    return Response.json({ id: r.id });
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return inWorkspace(async ({ repo }) => {
    await repo.briefs.remove(id);
    return Response.json({ ok: true });
  });
}
