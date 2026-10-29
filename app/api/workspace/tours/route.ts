import { InputError } from "@/lib/db/scoped";
import type { TourUserData } from "@/lib/db/schema";
import { tourDraft } from "@/lib/tools/tour";
import { VENUE_BANDS } from "@/lib/tools/venue-bands";
import { inWorkspace, readJson, inFeature } from "@/lib/workspace/route";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (x: unknown) => (typeof x === "string" && DATE.test(x) && !Number.isNaN(Date.parse(x)) ? x : "");

/**
 * GET → the workspace's saved tours. POST {draftId, window?, stops?} saves a tour from its
 * server-side draft (the engine's result) with the user's own dates and venue sizes. DELETE ?id=.
 */
export async function GET(): Promise<Response> {
  return inWorkspace(async ({ repo }) => Response.json({ tours: await repo.tours.list() }));
}

export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inFeature("optimizers", async ({ repo }) => {
    const result = await tourDraft(typeof body.draftId === "string" ? body.draftId : "");
    if (!result) throw new InputError("That tour has expired. Optimize it again, then save.");
    const w = (body.window ?? {}) as Record<string, unknown>;
    const given = (body.stops ?? {}) as Record<string, Record<string, unknown> | undefined>;
    const stops: TourUserData["stops"] = {};
    for (const s of result.route.stops) {
      const v = given[s.city.id];
      const band = typeof v?.band === "string" && (VENUE_BANDS as readonly string[]).includes(v.band) ? v.band : "";
      const d = date(v?.date);
      if (band || d) stops[s.city.id] = { band, date: d };
    }
    const name = `${result.fanbase.name} · ${result.route.stops.length} stops · ${result.markets.map((m) => m.name).join(", ")}`;
    const id = await repo.tours.save(name, result, { window: { from: date(w.from), to: date(w.to) }, stops });
    return Response.json({ id, name });
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return inWorkspace(async ({ repo }) => {
    await repo.tours.remove(id);
    return Response.json({ ok: true });
  });
}
