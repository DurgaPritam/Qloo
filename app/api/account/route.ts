import { cookies } from "next/headers";
import { connection } from "next/server";

import { currentWorkspace, WORKSPACE_COOKIE, WORKSPACE_COOKIE_OPTIONS } from "@/lib/workspace/session";

export interface AccountState {
  user: { email: string | null; name: string | null } | null;
  workspace?: { id: string; name: string; role: string; members?: number };
  workspaces?: { id: string; name: string; role: string }[];
  unread?: number;
}

/** GET → who is signed in, their current workspace and unread mentions (for the header). */
export async function GET(): Promise<Response> {
  await connection();
  const found = await currentWorkspace();
  if (!found) return Response.json({ user: null } satisfies AccountState, { headers: { "Cache-Control": "no-store" } });
  const { user, ctx, memberships, repo } = found;
  const current = memberships.find((m) => m.workspaceId === ctx.workspaceId)!;
  const body: AccountState = {
    user: { email: user.email, name: user.name },
    workspace: { id: current.workspaceId, name: current.name, role: current.role, members: (await repo.members.list()).length },
    workspaces: memberships.map((m) => ({ id: m.workspaceId, name: m.name, role: m.role })),
    unread: await repo.notifications.unread(),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}

/** POST {workspaceId} → switches the current workspace (only to one the user belongs to). */
export async function POST(req: Request): Promise<Response> {
  const found = await currentWorkspace();
  if (!found) return Response.json({ error: "Sign in first." }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { workspaceId?: unknown } | null;
  const target = found.memberships.find((m) => m.workspaceId === body?.workspaceId);
  if (!target) return Response.json({ error: "You're not in that workspace." }, { status: 403 });
  (await cookies()).set(WORKSPACE_COOKIE, target.workspaceId, WORKSPACE_COOKIE_OPTIONS);
  return Response.json({ ok: true });
}
