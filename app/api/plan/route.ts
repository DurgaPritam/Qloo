import { runAgent } from "@/lib/agent/loop";
import { createPlanner } from "@/lib/agent/planner";
import type { AgentEvent, Overrides } from "@/lib/agent/types";
import { getQlooSource } from "@/lib/qloo/source";
import { savePlan } from "@/lib/server/plan-store";
import { getLimiters, LIMITS, visitorId } from "@/lib/server/rate-limit";
import { SSE_HEADERS, sseStream } from "@/lib/server/sse";

export const maxDuration = 60;

const MAX_QUERY = 100;
const MAX_ID = 200;

/**
 * POST {query, overrides?} → SSE stream of agent events, ending with a "final" event that holds
 * the plan. Overrides re-run the plan with the user's pick; upstream Qloo calls hit the cache.
 */
export async function POST(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Send JSON: {\"query\": \"a fanbase\"}." }, { status: 400 });
  }
  const { query, overrides } = parseBody(body);
  if (!query) {
    return Response.json({ error: `Type a fanbase name (1–${MAX_QUERY} characters).` }, { status: 400 });
  }

  const source = getQlooSource();
  const mock = source.mock;
  const runId = crypto.randomUUID();
  const replan = Object.keys(overrides).length > 0;
  const limiter = replan ? getLimiters().replans : getLimiters().runs;
  const limit = await limiter.check(visitorId(req.headers));

  const stream = sseStream(async (send) => {
    if (!limit.ok) {
      const minutes = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 60_000));
      const allowed = replan ? LIMITS.replansPerHour : LIMITS.runsPerHour;
      send({
        step: "final",
        status: "error",
        summary: `You've used your ${allowed} live ${replan ? "replans" : "runs"} this hour. Try a cached example, or come back in about ${minutes} min.`,
        qlooCall: null,
        data: { rateLimited: true, retryAfterSec: minutes * 60 },
        mock,
      } satisfies AgentEvent);
      return;
    }
    try {
      const plan = await runAgent(
        { query },
        { runId, overrides, source, planner: createPlanner(), emit: send, signal: req.signal },
      );
      await savePlan(plan);
    } catch (err) {
      console.error("[api/plan] run failed:", err instanceof Error ? err.name : "unknown");
      send({
        step: "final",
        status: "error",
        summary: "Something went wrong while planning. Try again, or open a cached example.",
        qlooCall: null,
        mock,
      } satisfies AgentEvent);
    }
  });

  return new Response(stream, { headers: { ...SSE_HEADERS, "X-Run-Id": runId } });
}

function parseBody(body: unknown): { query: string; overrides: Overrides } {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const raw = typeof b.query === "string" ? b.query.trim() : "";
  const query = raw.length <= MAX_QUERY ? raw : "";
  const o = (b.overrides && typeof b.overrides === "object" ? b.overrides : {}) as Record<string, unknown>;
  const overrides: Overrides = {};
  for (const k of ["entityId", "partnerId", "cityId"] as const) {
    const v = o[k];
    if (typeof v === "string" && v.length > 0 && v.length <= MAX_ID) overrides[k] = v;
  }
  return { query, overrides };
}
