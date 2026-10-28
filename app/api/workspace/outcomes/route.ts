import { logOutcome, parseOutcome } from "@/lib/outcomes/service";
import { inWorkspace, readJson } from "@/lib/workspace/route";

/** POST {planId, attendance?, ticketsSold?, capacity?, gross?, sponsorRenewed?, notes?} → logs (or replaces) a plan's results. */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  const planId = typeof body.planId === "string" && /^[0-9a-f-]{36}$/.test(body.planId) ? body.planId : null;
  if (!planId) return Response.json({ error: "Which plan?" }, { status: 400 });
  return inWorkspace(async ({ repo }) => {
    await logOutcome(repo, planId, parseOutcome(body));
    return Response.json({ ok: true });
  });
}
