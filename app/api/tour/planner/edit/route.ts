import { aiEdit, AI_FALLBACK } from "@/lib/itinerary/ai-edit";
import { parseItinerary } from "@/lib/itinerary/types";
import { createProvider } from "@/lib/llm";
import { TokenBudgetExceededError } from "@/lib/llm/budget";
import { isMockMode } from "@/lib/mock-mode";
import { getLimiters, isE2eRequest, visitorId } from "@/lib/server/rate-limit";

export const maxDuration = 30;

/**
 * POST {itinerary, instruction} → {status: "ok", ops, rejected, summary} with checked edit ops for
 * the browser to apply (lib/itinerary/edits.ts applyEdits), or {status: "fallback", reason} when
 * the model could not run. The model proposes ops only; nothing is applied or stored here.
 */
export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { itinerary?: unknown; instruction?: unknown } | null;
  const instruction = typeof body?.instruction === "string" ? body.instruction.trim() : "";
  if (!instruction || instruction.length > 400) return Response.json({ error: "Type what to change (1–400 characters)." }, { status: 400 });
  const itinerary = parseItinerary(body?.itinerary);
  if (!itinerary) return Response.json({ error: "That tour couldn't be read. Reload the page and try again." }, { status: 400 });

  const mock = isMockMode();
  const limit = isE2eRequest(req.headers) ? { ok: true } : await getLimiters().replans.check(visitorId(req.headers));
  if (!limit.ok) return Response.json({ error: "Too many AI edits this hour. Edit the fields directly, or try again later.", mock }, { status: 429 });

  try {
    // Sample data never spends model quota.
    const result = await aiEdit(itinerary, instruction, { provider: mock ? null : createProvider(), mock, today: new Date().toISOString().slice(0, 10) });
    return Response.json({ ...result, mock });
  } catch (err) {
    if (err instanceof TokenBudgetExceededError) {
      return Response.json({ status: "fallback", reason: `Takeover has used today's AI budget. ${AI_FALLBACK}`, mock });
    }
    console.error("[api/tour/planner/edit] failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ status: "fallback", reason: `The AI model is unavailable right now. ${AI_FALLBACK}`, mock });
  }
}
