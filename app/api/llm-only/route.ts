import { TokenBudgetExceededError } from "@/lib/llm/budget";
import { isMockMode } from "@/lib/mock-mode";
import { llmOnlyAnswer } from "@/lib/server/llm-only";
import { getLimiters, isE2eRequest, visitorId } from "@/lib/server/rate-limit";

export const maxDuration = 30;

/**
 * POST {query} → {text, noSources: true, model, cached, mock}: the same model with no tools and
 * no Qloo data, for the "With Qloo | LLM only" toggle.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { query?: unknown } | null;
  const query = typeof body?.query === "string" ? body.query.trim() : "";
  if (!query || query.length > 100) {
    return Response.json({ error: "Type a fanbase name (1–100 characters)." }, { status: 400 });
  }

  const mock = isMockMode();
  const limit = isE2eRequest(req.headers) ? { ok: true } : await getLimiters().replans.check(visitorId(req.headers));
  if (!limit.ok) {
    return Response.json({ error: "Too many comparisons this hour. Try again later.", mock }, { status: 429 });
  }

  try {
    const answer = await llmOnlyAnswer(query, { mock });
    if (!answer) {
      return Response.json({ error: "The LLM-only comparison is not configured.", mock }, { status: 503 });
    }
    return Response.json(answer);
  } catch (err) {
    if (err instanceof TokenBudgetExceededError) {
      return Response.json(
        { error: "Takeover has used today's AI budget. Cached comparisons still work; live ones reopen tomorrow.", mock },
        { status: 429 },
      );
    }
    console.error("[api/llm-only] failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "The comparison model is unavailable right now.", mock }, { status: 502 });
  }
}
