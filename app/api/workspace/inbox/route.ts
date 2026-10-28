import { inWorkspace } from "@/lib/workspace/route";

/** POST → marks the caller's mentions in the current workspace as read. */
export async function POST(): Promise<Response> {
  return inWorkspace(async ({ repo }) => {
    await repo.notifications.markAllRead();
    return Response.json({ ok: true });
  });
}
