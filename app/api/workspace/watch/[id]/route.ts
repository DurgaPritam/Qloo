import { inWorkspace } from "@/lib/workspace/route";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE → stop watching; its snapshots and alerts go with it. */
export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return inWorkspace(async ({ repo }) => {
    await repo.watch.remove(id);
    return Response.json({ ok: true });
  });
}
