import "server-only";

import { withBudget, type BudgetedSource } from "@/lib/agent/budget";
import { getQlooSource } from "@/lib/qloo/source";

import { getLimiters, isE2eRequest, LIMITS, visitorId } from "./rate-limit";

/**
 * Shared handling for the lookup tools (Venue booker, Brand match, City explorer): JSON body,
 * the per-visitor tools limit, Qloo configuration and a small per-request call budget. Returns
 * either a ready error Response or what the tool needs.
 */
export async function toolRequest(
  req: Request,
  { budget }: { budget: number },
): Promise<{ error: Response } | { body: Record<string, unknown>; source: BudgetedSource; runId: string; mock: boolean }> {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return { error: Response.json({ error: "Send JSON." }, { status: 400 }) };

  const raw = getQlooSource();
  const mock = raw.mock;
  if (!mock && !(process.env.QLOO_API_KEY?.trim() && process.env.QLOO_BASE_URL?.trim())) {
    console.error("[api/tools] not configured: QLOO_API_KEY or QLOO_BASE_URL is missing.");
    return { error: Response.json({ error: "Qloo data is unavailable right now.", code: "qloo_unconfigured", mock }, { status: 503 }) };
  }

  if (!isE2eRequest(req.headers)) {
    const limit = await getLimiters().tools.check(visitorId(req.headers));
    if (!limit.ok) {
      const minutes = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 60_000));
      return {
        error: Response.json(
          { error: `You've used your ${LIMITS.toolsPerHour} lookups this hour. Try again in about ${minutes} min.`, mock },
          { status: 429 },
        ),
      };
    }
  }
  const runId = `tool-${crypto.randomUUID()}`;
  return { body, source: withBudget(raw, runId, budget), runId, mock };
}

/** A trimmed string field of at most `max` characters, or "". */
export function text(value: unknown, max = 100): string {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length <= max ? s : "";
}
