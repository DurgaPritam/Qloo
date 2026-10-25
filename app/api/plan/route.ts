import { runAgent } from "@/lib/agent/loop";
import { createPlanner, plannerStatus } from "@/lib/agent/planner";
import type { AgentEvent, Overrides } from "@/lib/agent/types";
import { getQlooSource } from "@/lib/qloo/source";
import { savePlan } from "@/lib/server/plan-store";
import { DAILY_ID, getLimiters, isE2eRequest, LIMITS, visitorId, type LimitResult } from "@/lib/server/rate-limit";
import { loadRecording, replay } from "@/lib/server/replay";
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
  const replan = Object.keys(overrides).length > 0;

  // Preloaded examples replay a stored run: instant, free, and not counted against any limit.
  const recording = !mock && !replan ? await loadRecording(query) : null;
  if (recording) {
    const stream = sseStream((send) => replay(recording, send, { signal: req.signal }));
    return new Response(stream, { headers: { ...SSE_HEADERS, "X-Run-Id": recording.plan.runId } });
  }

  // Outside mock mode a run needs Qloo credentials; say so instead of failing at step 1.
  if (!mock && !(process.env.QLOO_API_KEY?.trim() && process.env.QLOO_BASE_URL?.trim())) {
    console.error("[api/plan] not configured: QLOO_API_KEY or QLOO_BASE_URL is missing.");
    return Response.json(
      {
        error: "Takeover isn't fully configured yet: Qloo data is unavailable, so nothing was planned. Try a cached example.",
        code: "qloo_unconfigured",
        mock,
      },
      { status: 503 },
    );
  }

  // In production a missing model key is a configuration error, never a scripted plan.
  const planner = plannerStatus();
  if (!planner.ok) {
    console.error(`[api/plan] not configured: ${planner.reason}`);
    return Response.json(
      {
        error: "Takeover isn't fully configured yet: the planning model is unavailable, so nothing was planned. Try a cached example.",
        code: "planner_unconfigured",
        mock,
      },
      { status: 503 },
    );
  }

  const runId = crypto.randomUUID();
  const limiters = getLimiters();
  const visitor = isE2eRequest(req.headers)
    ? { ok: true, limit: 0, remaining: 0, resetAt: 0 }
    : await (replan ? limiters.replans : limiters.runs).check(visitorId(req.headers));
  const daily = visitor.ok ? await limiters.daily.check(DAILY_ID) : null;
  let limited: { summary: string; retryAfterSec: number } | null = null;
  if (!visitor.ok) limited = limitedMessage(visitor, replan);
  else if (daily && !daily.ok) limited = dailyMessage(daily);

  const stream = sseStream(async (send) => {
    if (limited) {
      send({
        step: "final",
        status: "error",
        summary: limited.summary,
        qlooCall: null,
        data: { rateLimited: true, retryAfterSec: limited.retryAfterSec },
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

function minutesUntil(resetAt: number): number {
  return Math.max(1, Math.ceil((resetAt - Date.now()) / 60_000));
}

function limitedMessage(limit: LimitResult, replan: boolean) {
  const minutes = minutesUntil(limit.resetAt);
  const allowed = replan ? LIMITS.replansPerHour : LIMITS.runsPerHour;
  return {
    summary: `You've used your ${allowed} live ${replan ? "replans" : "runs"} this hour. Try a cached example, or come back in about ${minutes} min.`,
    retryAfterSec: minutes * 60,
  };
}

function dailyMessage(limit: LimitResult) {
  return {
    summary: "Takeover has reached today's limit of live runs. The cached examples still work, and live runs reopen tomorrow.",
    retryAfterSec: minutesUntil(limit.resetAt) * 60,
  };
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
