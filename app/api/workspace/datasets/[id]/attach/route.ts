import { BudgetExceededError } from "@/lib/qloo/errors";
import { getQlooSource } from "@/lib/qloo/source";
import { findAct } from "@/lib/roster/resolve";
import { qlooReady } from "@/lib/roster/service";
import { can, ForbiddenError } from "@/lib/workspace/permissions";
import { inDataset, readJson } from "@/lib/workspace/route";

type Ctx = { params: Promise<{ id: string }> };

/** POST {query, entityId?} attaches the dataset to a fanbase (one Qloo search); {detach: true} removes it. */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const body = await readJson(req);
  return inDataset(id, async ({ repo, ctx }) => {
    if (!can(ctx.role, "data.edit")) throw new ForbiddenError("data.edit");
    if (body.detach === true) {
      await repo.datasets.attach(id, null);
      return Response.json({ status: "detached" });
    }
    const query = typeof body.query === "string" ? body.query.trim().slice(0, 100) : "";
    if (!query) return Response.json({ error: "Name the fanbase this data is about." }, { status: 400 });
    const source = getQlooSource();
    if (!qlooReady(source)) return Response.json({ error: "Qloo data is unavailable right now." }, { status: 503 });
    const entityId = typeof body.entityId === "string" && body.entityId.length <= 200 ? body.entityId : undefined;
    try {
      const found = await findAct(query, entityId, source, { kind: "workspace", workspaceId: ctx.workspaceId });
      if (found.status !== "resolved") return Response.json(found);
      await repo.datasets.attach(id, { id: found.entity.id, name: found.entity.name, category: found.entity.category });
      return Response.json({ status: "attached", name: found.entity.name });
    } catch (err) {
      if (err instanceof BudgetExceededError) return Response.json({ error: `${err.message}.` }, { status: 429 });
      throw err;
    }
  });
}
