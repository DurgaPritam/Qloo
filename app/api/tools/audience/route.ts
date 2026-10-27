import { toolRequest } from "@/lib/server/tool-route";
import { audienceProfiles } from "@/lib/tools/audience";
import type { CallView } from "@/lib/tools/shared";

export const maxDuration = 20;

/** POST {entityIds: [up to 2 Qloo ids]} → each fanbase's age and gender skew. */
export async function POST(req: Request): Promise<Response> {
  const r = await toolRequest(req, { budget: 2 });
  if ("error" in r) return r.error;
  const ids = Array.isArray(r.body.entityIds)
    ? r.body.entityIds.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200).slice(0, 2)
    : [];
  if (!ids.length) return Response.json({ error: "Send entityIds.", mock: r.mock }, { status: 400 });
  const calls: CallView[] = [];
  const profiles = await audienceProfiles(ids, r.source, { runId: r.runId }, calls);
  return Response.json({ profiles, calls, mock: r.mock });
}
