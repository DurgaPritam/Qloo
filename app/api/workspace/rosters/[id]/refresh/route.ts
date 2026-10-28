import { startRefresh } from "@/lib/roster/service";
import { inRoster, readJson } from "@/lib/workspace/route";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST {force?} → refreshes what is stale (or everything, with force) after checking the
 * estimate against the workspace's allowance. Answers 429 with the reason when it would not fit.
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const body = await readJson(req);
  return inRoster(id, async ({ repo }) => {
    const outcome = await startRefresh(repo, id, { force: body.force === true });
    return Response.json(outcome, { status: outcome.status === "blocked" ? 429 : 200 });
  });
}
