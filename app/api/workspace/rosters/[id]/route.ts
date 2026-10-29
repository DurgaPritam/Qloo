import { needFeature } from "@/lib/workspace/gate";
import { rosterView } from "@/lib/roster/service";
import { inRoster, readJson } from "@/lib/workspace/route";

type Ctx = { params: Promise<{ id: string }> };

/** GET → everything the roster page shows. PATCH {name} renames it. DELETE removes it. */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return inRoster(id, async ({ repo }) => Response.json(await rosterView(repo, id)));
}

export async function PATCH(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const body = await readJson(req);
  return inRoster(id, async ({ repo }) => {
    await needFeature(repo, "rosters");
    await repo.rosters.rename(id, typeof body.name === "string" ? body.name : "");
    return Response.json({ ok: true });
  });
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return inRoster(id, async ({ repo }) => {
    await repo.rosters.remove(id);
    return Response.json({ ok: true });
  });
}
