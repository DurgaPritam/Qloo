import { inWorkspace, readJson } from "@/lib/workspace/route";

/** POST {name} → renames the current workspace (owners only). */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inWorkspace(async ({ repo }) => {
    await repo.workspace.rename(typeof body.name === "string" ? body.name : "");
    return Response.json({ ok: true });
  });
}
