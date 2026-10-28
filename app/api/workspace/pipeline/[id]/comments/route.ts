import { inWorkspace, readJson } from "@/lib/workspace/route";

type Ctx = { params: Promise<{ id: string }> };

/** POST {body, parentId?} → a comment on a pipeline card; @mentions notify those members. */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const body = await readJson(req);
  return inWorkspace(async ({ repo }) => {
    const r = await repo.pipeline.comment(id, { body: typeof body.body === "string" ? body.body : "", parentId: typeof body.parentId === "string" ? body.parentId : null });
    return Response.json(r);
  });
}
