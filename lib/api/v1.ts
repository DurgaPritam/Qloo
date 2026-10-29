import "server-only";

import { withBudget } from "@/lib/agent/budget";
import { InputError } from "@/lib/db/scoped";
import { has, limitsOf, upgradeFor } from "@/lib/entitlements";
import type { QlooScope } from "@/lib/qloo/allowance";
import { QLOO_RUN_BUDGET } from "@/lib/qloo/client";
import { qlooCommercialReady } from "@/lib/qloo/commercial";
import { BudgetExceededError } from "@/lib/qloo/errors";
import { getQlooSource, type QlooSource } from "@/lib/qloo/source";
import { apiLimiter } from "@/lib/server/rate-limit";
import { ForbiddenError } from "@/lib/workspace/permissions";
import { apiKeyContext } from "@/lib/workspace/session";

import { ATTRIBUTION } from "./attribution";

/**
 * The public API's request handling (/api/v1): a workspace key, the tier's per-minute limit and
 * monthly quota, a Qloo source on the workspace's allowance, and one envelope for every answer:
 *   { data, evidence, attribution, meta }
 * Errors carry the attribution too. Off on Vercel until TAKEOVER_PUBLIC_API=1, and in production
 * also until the commercial Qloo agreement is in place (lib/qloo/commercial.ts).
 */
type Env = Record<string, string | undefined>;
export const publicApiEnabled = (env: Env = process.env) => (env.TAKEOVER_PUBLIC_API === "1" || !env.VERCEL_ENV) && qlooCommercialReady(env);

export type ApiContext = NonNullable<Awaited<ReturnType<typeof apiKeyContext>>> & { source: QlooSource; scope: QlooScope; runId: string };
export interface ApiAnswer {
  data: unknown;
  evidence: unknown;
  status?: number;
}

const month = (d: Date) => d.toISOString().slice(0, 7);
const nextMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString();

export function apiError(status: number, code: string, message: string, headers: Record<string, string> = {}): Response {
  return Response.json({ error: { code, message }, attribution: ATTRIBUTION }, { status, headers });
}

export async function v1(req: Request, endpoint: string, handle: (ctx: ApiContext) => Promise<ApiAnswer>, opts: { now?: Date } = {}): Promise<Response> {
  if (!publicApiEnabled()) return apiError(403, "api_disabled", "The public API is not enabled on this deployment.");
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!key) return apiError(401, "unauthorized", "Send your API key as: Authorization: Bearer tk_…");
  const found = await apiKeyContext(key);
  if (!found) return apiError(401, "unauthorized", "That API key is not valid, or it has been revoked.");
  if (!has(found.tier, "api")) {
    const up = upgradeFor("api");
    return Response.json({ error: { code: "upgrade_required", message: up.reason }, upgrade: up, attribution: ATTRIBUTION }, { status: 402 });
  }
  const limits = limitsOf(found.tier).api;
  const now = opts.now ?? new Date();

  const rate = await apiLimiter(limits.perMinute).check(found.keyId);
  const rateHeaders = { "X-RateLimit-Limit": String(limits.perMinute), "X-RateLimit-Remaining": String(Math.max(0, rate.remaining)), "X-RateLimit-Reset": String(Math.ceil(rate.resetAt / 1000)) };
  if (!rate.ok) return apiError(429, "rate_limited", `Up to ${limits.perMinute} requests a minute on this plan. Try again shortly.`, { ...rateHeaders, "Retry-After": String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))) });

  const counted = await found.repo.api.count(found.keyId, endpoint, month(now), limits.monthly, now);
  const quota = { used: counted.used, limit: limits.monthly, resetsAt: nextMonth(now) };
  const quotaHeaders = { ...rateHeaders, "X-Quota-Limit": String(limits.monthly), "X-Quota-Used": String(quota.used) };
  if (!counted.ok) return apiError(429, "quota_exceeded", `This key has used its ${limits.monthly} requests for the month. It resets on ${quota.resetsAt.slice(0, 10)}.`, quotaHeaders);

  const runId = `api-${crypto.randomUUID()}`;
  const scope: QlooScope = { kind: "workspace", workspaceId: found.ctx.workspaceId };
  const source = withBudget(getQlooSource(), runId, QLOO_RUN_BUDGET);
  try {
    const answer = await handle({ ...found, source, scope, runId });
    return Response.json(
      { data: answer.data, evidence: answer.evidence, attribution: ATTRIBUTION, meta: { endpoint, requestId: runId, mock: source.mock, qlooCalls: source.used(), quota } },
      { status: answer.status ?? 200, headers: quotaHeaders },
    );
  } catch (err) {
    if (err instanceof InputError) return apiError(400, "invalid_request", err.message, quotaHeaders);
    if (err instanceof ForbiddenError) return apiError(403, "forbidden", "The key's owner cannot do that in this workspace.", quotaHeaders);
    if (err instanceof BudgetExceededError) return apiError(429, "qloo_budget", err.message, quotaHeaders);
    console.error(`[api/v1${endpoint}] failed:`, err instanceof Error ? err.name : "unknown");
    return apiError(502, "upstream_error", "Qloo didn't answer. Try again.", quotaHeaders);
  }
}
