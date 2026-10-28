import { ROLES, type Role } from "@/lib/db/schema";
import { inWorkspace, readJson } from "@/lib/workspace/route";

/** POST {action: "role", userId, role} | {action: "remove", userId} | {action: "leave"} */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inWorkspace(async ({ repo, user }) => {
    if (body.action === "leave") {
      await repo.members.remove(user.id);
      return Response.json({ ok: true });
    }
    if (typeof body.userId !== "string") return Response.json({ error: "Send userId." }, { status: 400 });
    if (body.action === "remove") {
      await repo.members.remove(body.userId);
      return Response.json({ ok: true });
    }
    const role = ROLES.find((r) => r === body.role) as Role | undefined;
    if (body.action !== "role" || !role) return Response.json({ error: "Send action and role." }, { status: 400 });
    await repo.members.changeRole(body.userId, role);
    return Response.json({ ok: true });
  });
}
