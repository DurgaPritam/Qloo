import { createPlan } from "@/lib/api/endpoints";
import { v1 } from "@/lib/api/v1";

/** POST /api/v1/plans {query, entityId?} → 202 and a job id; poll GET /api/v1/plans/{planId}. */
export async function POST(req: Request): Promise<Response> {
  const body = ((await req.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return v1(req, "/plans", (c) => createPlan(c, body));
}
