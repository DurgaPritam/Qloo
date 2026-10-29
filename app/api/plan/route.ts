import { runAgent } from "@/lib/agent/loop";
import { createPlanner, plannerStatus } from "@/lib/agent/planner";
import { PARTNER_CATEGORIES } from "@/lib/agent/tools";
import type { AgentEvent, Overrides } from "@/lib/agent/types";
import type { Category } from "@/lib/engine/types";
import { getTokenBudget } from "@/lib/llm/budget";
import { getQlooSource } from "@/lib/qloo/source";
import { savePlan } from "@/lib/server/plan-store";
import { recordTrend } from "@/lib/server/trending";
import { DAILY_ID, getLimiters, isE2eRequest, LIMITS, visitorId, type LimitResult } from "@/lib/server/rate-limit";
import { loadRecording, replay } from "@/lib/server/replay";
import { SSE_HEADERS, sseStream } from "@/lib/server/sse";
import { can } from "@/lib/workspace/permissions";
import { planSaving } from "@/lib/workspace/gate";
import { currentWorkspace } from "@/lib/workspace/session";

/** A run makes about six model calls; on a slow day Gemini takes 10–15 s each (decisions D39). */
export const maxDuration = 300;

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
  let limited: { summary: string; retryAfterSec: number } | null = null;
  // Today's model token budget comes first, so a refused run costs the visitor nothing.
  const budget = getTokenBudget();
  if (planner.kind !== "scripted" && (await budget.exceeded())) limited = budgetMessage(budget.resetsAt());
  if (!limited) {
    const limiters = getLimiters();
    const visitor = isE2eRequest(req.headers)
      ? { ok: true, limit: 0, remaining: 0, resetAt: 0 }
      : await (replan ? limiters.replans : limiters.runs).check(visitorId(req.headers));
    const daily = visitor.ok ? await limiters.daily.check(DAILY_ID) : null;
    if (!visitor.ok) limited = limitedMessage(visitor, replan);
    else if (daily && !daily.ok) limited = dailyMessage(daily);
  }

  // Signed-in members save to their workspace: private by default, so never to the public
  // store, the "Just planned" list or trending. Viewers and signed-out visitors save as before.
  const found = limited ? null : await currentWorkspace();
  // Saving to a workspace is a Pro feature with a monthly limit (lib/entitlements.ts); otherwise the
  // run is kept like a signed-out one, in My plans, and the header says what would unlock saving.
  const gate = found && can(found.ctx.role, "plan.create") ? await planSaving(found.repo) : null;
  const workspace = gate?.ok ? found : null;
  const workspaceName = workspace?.memberships.find((m) => m.workspaceId === workspace.ctx.workspaceId)?.name;

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
        {
          runId,
          overrides,
          source,
          planner: createPlanner(),
          emit: send,
          signal: req.signal,
          scope: workspace ? { kind: "workspace", workspaceId: workspace.ctx.workspaceId } : undefined,
        },
      );
      if (workspace) {
        await saveToWorkspace(workspace.repo, query, plan);
        return;
      }
      await savePlan(plan);
      if (!plan.mock && plan.status === "complete" && plan.fanbase) {
        await Promise.all([
          recordTrend("fanbase", plan.fanbase.name),
          plan.room ? recordTrend("city", `${plan.room.cityName}|${plan.city?.chosen?.pick.city.country ?? ""}`) : null,
        ]);
      }
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

  const saved: Record<string, string> = workspaceName ? { "X-Saved-To": encodeURIComponent(workspaceName) } : gate && !gate.ok ? { "X-Upgrade": encodeURIComponent(gate.reason) } : {};
  return new Response(stream, { headers: { ...SSE_HEADERS, "X-Run-Id": runId, ...saved } });
}

/** One retry: a lost save would lose the team's plan, and it must never fall back to the public store. */
async function saveToWorkspace(repo: NonNullable<Awaited<ReturnType<typeof currentWorkspace>>>["repo"], query: string, plan: Parameters<typeof savePlan>[0]) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await repo.plans.create({ id: plan.runId, query, result: plan });
      return;
    } catch (err) {
      console.error("[api/plan] workspace save failed:", err instanceof Error ? err.name : "unknown");
    }
  }
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

function budgetMessage(resetAt: number) {
  return {
    summary: "Takeover has used today's AI budget for live runs. The cached examples still work, and live runs reopen tomorrow.",
    retryAfterSec: minutesUntil(resetAt) * 60,
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
  const pc = o.partnerCategory;
  if (overrides.partnerId && typeof pc === "string" && (PARTNER_CATEGORIES as readonly string[]).includes(pc)) {
    overrides.partnerCategory = pc as Category;
  }
  return { query, overrides };
}
