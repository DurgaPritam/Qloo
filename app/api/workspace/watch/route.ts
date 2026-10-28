import { BudgetExceededError } from "@/lib/qloo/errors";
import { getQlooSource } from "@/lib/qloo/source";
import { qlooReady } from "@/lib/roster/service";
import { addWatch, watchView } from "@/lib/watch/service";
import { inWorkspace, readJson } from "@/lib/workspace/route";

/** GET → the Market watch page's data. POST {kind, query, entityId?, cityId?} → watch it (first snapshot now). */
export async function GET(): Promise<Response> {
  return inWorkspace(async ({ repo }) => Response.json(await watchView(repo)));
}

export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  const kind = body.kind === "city" ? "city" : body.kind === "fanbase" ? "fanbase" : null;
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 100) : "";
  if (!kind || !query) return Response.json({ error: "Name a fanbase or a city to watch." }, { status: 400 });
  return inWorkspace(async ({ repo }) => {
    const source = getQlooSource();
    if (!qlooReady(source)) return Response.json({ error: "Qloo data is unavailable right now." }, { status: 503 });
    try {
      const result = await addWatch(
        repo,
        {
          kind,
          query,
          entityId: typeof body.entityId === "string" && body.entityId.length <= 200 ? body.entityId : undefined,
          cityId: typeof body.cityId === "string" && /^\d{1,12}$/.test(body.cityId) ? body.cityId : undefined,
        },
        { source },
      );
      return Response.json(result);
    } catch (err) {
      if (err instanceof BudgetExceededError) return Response.json({ error: `${err.message}.` }, { status: 429 });
      throw err;
    }
  });
}
