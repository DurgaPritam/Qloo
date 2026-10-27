import { toolRequest, text } from "@/lib/server/tool-route";
import { BOOKING_KINDS, bookFor, type BookingKind } from "@/lib/tools/venue";

export const maxDuration = 30;

/** POST {city, kinds?} → who people in that city over-index on: artists, stand-up comedians, podcasts. */
export async function POST(req: Request): Promise<Response> {
  const r = await toolRequest(req, { budget: BOOKING_KINDS.length });
  if ("error" in r) return r.error;
  const city = text(r.body.city, 80);
  if (!city) return Response.json({ error: "Type a city (1–80 characters).", mock: r.mock }, { status: 400 });
  const asked = Array.isArray(r.body.kinds) ? r.body.kinds.filter((k): k is BookingKind => BOOKING_KINDS.includes(k)) : [];

  try {
    const result = await bookFor(city, asked.length ? asked : BOOKING_KINDS, r.source, { runId: r.runId });
    if (!result) {
      return Response.json(
        { error: `We don't have a city called “${city}” in our list (cities of 100,000 people or more).`, mock: r.mock },
        { status: 404 },
      );
    }
    return Response.json(result);
  } catch (err) {
    console.error("[api/tools/venue] failed:", err instanceof Error ? err.name : "unknown");
    return Response.json({ error: "Something went wrong. Try again.", mock: r.mock }, { status: 502 });
  }
}
