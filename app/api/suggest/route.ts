import { connection } from "next/server";

import { withBudget } from "@/lib/agent/budget";
import { mergeSamePerson } from "@/lib/engine/match";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import { getQlooSource } from "@/lib/qloo/source";
import { getLimiters, isE2eRequest, visitorId } from "@/lib/server/rate-limit";

export const maxDuration = 10;

/**
 * GET ?q= → up to six Qloo search results for the search box, as you type. Needs 3+ characters;
 * one search per request, cached by the Qloo client, with its own per-visitor limit.
 */
export async function GET(req: Request): Promise<Response> {
  await connection();
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 3 || q.length > 100) return Response.json({ suggestions: [] });
  if (!isE2eRequest(req.headers)) {
    const limit = await getLimiters().suggest.check(visitorId(req.headers));
    if (!limit.ok) return Response.json({ suggestions: [], limited: true }, { status: 429 });
  }
  const raw = getQlooSource();
  if (!raw.mock && !(process.env.QLOO_API_KEY?.trim() && process.env.QLOO_BASE_URL?.trim())) {
    return Response.json({ suggestions: [] });
  }
  try {
    const source = withBudget(raw, `suggest-${crypto.randomUUID()}`, 1);
    const res = await source.searchEntities(q, FANBASE_CATEGORIES, { runId: `suggest-${crypto.randomUUID()}` });
    const suggestions = mergeSamePerson(res.data)
      .slice(0, 6)
      .map((e) => ({ name: e.name, category: e.category, detail: (e.description ?? e.disambiguation)?.slice(0, 80) }));
    return Response.json({ suggestions, mock: raw.mock }, { headers: { "Cache-Control": "private, max-age=300" } });
  } catch {
    return Response.json({ suggestions: [] });
  }
}
