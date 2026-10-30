import { InputError } from "@/lib/db/scoped";
import { parseItinerary } from "@/lib/itinerary/types";
import { inFeature, inWorkspace, readJson } from "@/lib/workspace/route";

const UUID = /^[0-9a-f-]{36}$/;

/** The itinerary in a request body, checked and size-capped (lib/itinerary/types.ts). */
function itineraryFrom(body: Record<string, unknown>) {
  const it = parseItinerary(body.itinerary);
  if (!it) throw new InputError("That tour couldn't be saved: it is too large or not a tour.");
  return it;
}

/**
 * Tour planner itineraries in the current workspace. GET → the list, or one with ?id=.
 * POST {itinerary} saves a new one; PUT ?id= {itinerary} replaces one; DELETE ?id=.
 */
export async function GET(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return inWorkspace(async ({ repo }) => {
    if (!id) return Response.json({ itineraries: await repo.itineraries.list() });
    const row = UUID.test(id) ? await repo.itineraries.get(id) : null;
    return row ? Response.json({ id: row.id, name: row.name, itinerary: row.data, updatedAt: row.updatedAt }) : Response.json({ error: "That tour isn't in this workspace." }, { status: 404 });
  });
}

export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inFeature("optimizers", async ({ repo }) => {
    const it = itineraryFrom(body);
    return Response.json({ id: await repo.itineraries.create(it), name: it.name });
  });
}

export async function PUT(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const body = await readJson(req);
  return inFeature("optimizers", async ({ repo }) => {
    const it = itineraryFrom(body);
    const ok = UUID.test(id) && (await repo.itineraries.update(id, it));
    return ok ? Response.json({ id, name: it.name }) : Response.json({ error: "That tour isn't in this workspace." }, { status: 404 });
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return inWorkspace(async ({ repo }) => {
    if (UUID.test(id)) await repo.itineraries.remove(id);
    return Response.json({ ok: true });
  });
}
