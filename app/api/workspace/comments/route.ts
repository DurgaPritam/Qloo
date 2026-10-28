import { connection } from "next/server";

import { COMMENT_TARGETS, type CommentTarget } from "@/lib/db/schema";
import { handlesFor } from "@/lib/workspace/mentions";
import { can } from "@/lib/workspace/permissions";
import { inPlanWorkspace, readJson } from "@/lib/workspace/route";
import { planTargets } from "@/lib/workspace/targets";

/** GET ?planId= → the plan's comment threads, its decisions, members' @handles and what the caller may do. */
export async function GET(req: Request): Promise<Response> {
  await connection();
  const planId = new URL(req.url).searchParams.get("planId");
  return inPlanWorkspace(planId, async ({ repo, plan, role }) => {
    const [rows, members] = await Promise.all([repo.comments.list(plan.runId), repo.members.list()]);
    const handles = handlesFor(members);
    return Response.json({
      me: repo.context.userId,
      can: { comment: can(role, "comment.create"), resolve: can(role, "comment.resolve") },
      targets: planTargets(plan),
      members: members.map((m) => ({ handle: handles.get(m.userId) ?? null, name: m.name ?? m.email })).filter((m) => m.handle),
      comments: rows.map((c) => ({
        id: c.id,
        targetType: c.targetType,
        targetId: c.targetId,
        parentId: c.parentId,
        body: c.body,
        author: c.author ?? c.authorEmail ?? "Former member",
        mine: c.authorId === repo.context.userId,
        resolved: Boolean(c.resolvedAt),
        createdAt: c.createdAt,
      })),
    });
  });
}

/** POST {planId, targetType, targetId, parentId?, body} → adds a comment; @handles notify those members. */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  const targetType = COMMENT_TARGETS.find((t) => t === body.targetType) as CommentTarget | undefined;
  if (!targetType || typeof body.targetId !== "string" || typeof body.body !== "string") {
    return Response.json({ error: "Send targetType, targetId and body." }, { status: 400 });
  }
  return inPlanWorkspace(body.planId, async ({ repo, plan }) => {
    const added = await repo.comments.add({
      planId: plan.runId,
      targetType,
      targetId: body.targetId as string,
      parentId: typeof body.parentId === "string" ? body.parentId : null,
      body: body.body as string,
    });
    return Response.json({ id: added.id, mentioned: added.mentioned.length });
  });
}
