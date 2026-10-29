import { needFeature, withinLimit } from "@/lib/workspace/gate";
import { can, ForbiddenError } from "@/lib/workspace/permissions";
import { findAct } from "@/lib/roster/resolve";
import { qlooReady } from "@/lib/roster/service";
import { getQlooSource } from "@/lib/qloo/source";
import { BudgetExceededError } from "@/lib/qloo/errors";
import { inRoster, readJson } from "@/lib/workspace/route";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST {query, entityId?} → adds the act the resolver finds (one Qloo search), or returns the
 * choices for an ambiguous name. The act is scored by the next refresh, after its estimate is shown.
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const body = await readJson(req);
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 100) : "";
  const entityId = typeof body.entityId === "string" && body.entityId.length <= 200 ? body.entityId : undefined;
  if (!query) return Response.json({ error: "Type an act's name." }, { status: 400 });
  return inRoster(id, async ({ repo, ctx }) => {
    const plan = await needFeature(repo, "rosters");
    withinLimit(plan, "rosterActs", (await repo.rosters.acts(id)).length, `This plan's rosters hold up to ${plan.limits.rosterActs} acts.`);
    if (!can(ctx.role, "roster.edit")) throw new ForbiddenError("roster.edit");
    const source = getQlooSource();
    if (!qlooReady(source)) return Response.json({ error: "Qloo data is unavailable right now." }, { status: 503 });
    try {
      const found = await findAct(query, entityId, source, { kind: "workspace", workspaceId: ctx.workspaceId });
      if (found.status !== "resolved") return Response.json(found);
      const { added } = await repo.rosters.addActs(id, [{ entity: found.entity }], "search");
      return Response.json({ status: added.length ? "added" : "already", name: found.entity.name });
    } catch (err) {
      if (err instanceof BudgetExceededError) return Response.json({ error: `${err.message}. Nothing was added.` }, { status: 429 });
      throw err;
    }
  });
}

/** DELETE ?act=<roster act id> → takes the act off the roster. */
export async function DELETE(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const actId = new URL(req.url).searchParams.get("act") ?? "";
  return inRoster(id, async ({ repo }) => {
    await repo.rosters.removeAct(id, actId);
    return Response.json({ ok: true });
  });
}
