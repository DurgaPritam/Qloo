import { isTier } from "@/lib/entitlements";
import { queueMode } from "@/lib/jobs/queue";
import { isE2eRequest } from "@/lib/server/rate-limit";
import { inWorkspace, readJson } from "@/lib/workspace/route";

/** Local and e2e only (404 elsewhere): sets the current workspace's tier, until billing exists. */
export async function POST(req: Request): Promise<Response> {
  if (queueMode() !== "local" || !isE2eRequest(req.headers)) return Response.json({ error: "Not found." }, { status: 404 });
  const body = await readJson(req);
  if (!isTier(body.tier)) return Response.json({ error: "Unknown tier." }, { status: 400 });
  const tier = body.tier;
  return inWorkspace(async ({ repo }) => {
    await repo.workspace.setTier(tier);
    return Response.json({ tier });
  });
}
