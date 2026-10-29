import { loadPlan } from "@/lib/server/plan-store";
import { importBrowserPlans } from "@/lib/workspace/context";
import { readJson, inFeature } from "@/lib/workspace/route";

const ID = /^[0-9a-f-]{36}$/;

/** POST {runIds} → copies plans saved in this browser (My plans) into the current workspace. */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  const runIds = Array.isArray(body.runIds) ? body.runIds.filter((x): x is string => typeof x === "string" && ID.test(x)) : [];
  return inFeature("workspace.plans", async ({ repo }) => Response.json(await importBrowserPlans(repo, runIds, loadPlan)));
}
