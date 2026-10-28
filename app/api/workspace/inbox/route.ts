import { notificationView } from "@/lib/workspace/notification-text";
import { inWorkspace } from "@/lib/workspace/route";

/** GET → the caller's latest mentions and pipeline reminders in the current workspace, for the bell. */
export async function GET(): Promise<Response> {
  return inWorkspace(async ({ repo }) => {
    const items = await repo.notifications.list(8);
    return Response.json({
      items: items.map((n) => ({
        id: n.id,
        ...notificationView(n),
        unread: !n.readAt,
        at: n.createdAt.toISOString(),
      })),
    });
  });
}

/** POST → marks the caller's mentions in the current workspace as read. */
export async function POST(): Promise<Response> {
  return inWorkspace(async ({ repo }) => {
    await repo.notifications.markAllRead();
    return Response.json({ ok: true });
  });
}
