import { inPlanWorkspace, readJson } from "@/lib/workspace/route";

/** POST {planId, visibility: "workspace" | "public"} → who can open the plan's link. */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  const visibility = body.visibility === "public" ? "public" : body.visibility === "workspace" ? "workspace" : null;
  if (!visibility) return Response.json({ error: "Choose workspace or public." }, { status: 400 });
  return inPlanWorkspace(body.planId, async ({ repo, plan }) => {
    await repo.plans.setVisibility(plan.runId, visibility);
    return Response.json({ ok: true, visibility });
  });
}
