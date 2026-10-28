import { shortlistMatch } from "@/lib/sponsorship/service";
import { inWorkspace, readJson } from "@/lib/workspace/route";

/** GET → the shortlist. POST {draftId, key} saves a match from a run. DELETE ?id= removes one. */
export async function GET(): Promise<Response> {
  return inWorkspace(async ({ repo }) => Response.json({ shortlist: await repo.sponsorship.shortlist() }));
}

export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inWorkspace(async ({ repo }) => {
    const id = await shortlistMatch(repo, typeof body.draftId === "string" ? body.draftId : "", typeof body.key === "string" ? body.key.slice(0, 200) : "");
    return Response.json({ id });
  });
}

export async function DELETE(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return inWorkspace(async ({ repo }) => {
    await repo.sponsorship.remove(id);
    return Response.json({ ok: true });
  });
}
