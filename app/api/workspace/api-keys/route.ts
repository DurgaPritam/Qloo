import { InputError } from "@/lib/db/scoped";
import { planOf } from "@/lib/workspace/gate";
import { inFeature, inWorkspace, readJson } from "@/lib/workspace/route";

/** POST {name} → a new API key, returned this once. DELETE ?id= revokes one. */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inFeature("api", async ({ repo }) => {
    const max = (await planOf(repo)).limits.api.keys;
    if ((await repo.api.liveKeys()) >= max) throw new InputError(`Your plan allows ${max} active keys. Revoke one first.`);
    return Response.json(await repo.api.createKey(typeof body.name === "string" ? body.name : ""), { headers: { "Cache-Control": "no-store" } });
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return inWorkspace(async ({ repo }) => {
    await repo.api.revokeKey(id);
    return Response.json({ ok: true });
  });
}
