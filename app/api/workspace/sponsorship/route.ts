import { BudgetExceededError } from "@/lib/qloo/errors";
import { getQlooSource } from "@/lib/qloo/source";
import { qlooReady } from "@/lib/roster/service";
import { runBrandView, runRightsView, type HolderInput } from "@/lib/sponsorship/service";
import { inWorkspace, readJson } from "@/lib/workspace/route";

export const maxDuration = 30;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * POST {view: "brand", query, entityId?} → talent, shows, podcasts and teams for a brand.
 * POST {view: "rights", holder: {kind: "entity", query, entityId?} | {kind: "event", planId} | {kind: "roster", rosterId, actId?}}
 * → brands to pitch. Qloo calls are charged to the workspace.
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inWorkspace(async ({ repo }) => {
    const source = getQlooSource();
    if (!qlooReady(source)) return Response.json({ error: "Qloo data is unavailable right now." }, { status: 503 });
    try {
      if (body.view === "brand") {
        const query = str(body.query, 100);
        if (!query) return Response.json({ error: "Name a brand." }, { status: 400 });
        return Response.json(await runBrandView(repo, { query, entityId: str(body.entityId, 200) || undefined }, source));
      }
      const h = (body.holder ?? {}) as Record<string, unknown>;
      let holder: HolderInput | null = null;
      if (h.kind === "entity" && str(h.query, 100)) holder = { kind: "entity", query: str(h.query, 100), entityId: str(h.entityId, 200) || undefined };
      else if (h.kind === "event" && /^[0-9a-f-]{36}$/.test(str(h.planId, 40))) holder = { kind: "event", planId: str(h.planId, 40) };
      else if (h.kind === "roster" && /^[0-9a-f-]{36}$/.test(str(h.rosterId, 40))) holder = { kind: "roster", rosterId: str(h.rosterId, 40), actId: /^[0-9a-f-]{36}$/.test(str(h.actId, 40)) ? str(h.actId, 40) : undefined };
      if (!holder) return Response.json({ error: "Name an act or team, or pick a plan or roster." }, { status: 400 });
      return Response.json(await runRightsView(repo, holder, source));
    } catch (err) {
      if (err instanceof BudgetExceededError) return Response.json({ error: `${err.message}.` }, { status: 429 });
      throw err;
    }
  });
}
