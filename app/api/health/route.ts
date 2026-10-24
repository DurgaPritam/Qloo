import { connection } from "next/server";

import { getHealth } from "@/lib/server/health";

/** GET → Qloo reachability, Redis status, remaining daily runs and per-visitor limits. No secrets. */
export async function GET(): Promise<Response> {
  await connection();
  const health = await getHealth();
  return Response.json(health, { headers: { "Cache-Control": "no-store" } });
}
