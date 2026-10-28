import { inPlanWorkspace, readJson } from "@/lib/workspace/route";

/** POST {planId, commentId, resolved} → resolves or reopens a thread. */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  if (typeof body.commentId !== "string") return Response.json({ error: "Send commentId." }, { status: 400 });
  return inPlanWorkspace(body.planId, async ({ repo }) => {
    await repo.comments.resolve(body.commentId as string, body.resolved !== false);
    return Response.json({ ok: true });
  });
}
