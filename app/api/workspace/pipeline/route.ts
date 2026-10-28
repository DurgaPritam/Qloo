import { inPlanWorkspace, inWorkspace, readJson } from "@/lib/workspace/route";

/**
 * GET → the board. POST {planId} adds a plan's two drafts (to the plan's own workspace);
 * POST {matchId} adds a shortlisted sponsor match. Nothing here sends email.
 */
export async function GET(): Promise<Response> {
  return inWorkspace(async ({ repo }) => Response.json({ cards: await repo.pipeline.list() }));
}

export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  if (body.planId !== undefined) return inPlanWorkspace(body.planId, async ({ repo, plan }) => Response.json({ added: await repo.pipeline.addFromPlan(plan.runId) }));
  return inWorkspace(async ({ repo }) => Response.json({ added: await repo.pipeline.addFromMatch(typeof body.matchId === "string" ? body.matchId : "") }));
}
