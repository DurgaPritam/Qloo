import { queueMode } from "@/lib/jobs/queue";
import { isE2eRequest } from "@/lib/server/rate-limit";
import { recordSnapshot, seededWeek } from "@/lib/watch/service";
import { inWorkspace, readJson } from "@/lib/workspace/route";

/**
 * Local and e2e only (404 elsewhere): records a second, seeded snapshot for an item, dated next
 * Monday, so the alerts, their before → after values and the digest can be checked by eye. The
 * seed is the item's real first snapshot with the 4th entry of each list moved to 1st and the 2nd
 * entry's value 8 points lower.
 */
export async function POST(req: Request): Promise<Response> {
  if (queueMode() !== "local" || !isE2eRequest(req.headers)) return Response.json({ error: "Not found." }, { status: 404 });
  const body = await readJson(req);
  return inWorkspace(async ({ repo }) => {
    const item = typeof body.itemId === "string" ? await repo.watch.item(body.itemId) : null;
    const [first] = item ? await repo.watch.snapshots(item.id, 1) : [];
    if (!item || !first) return Response.json({ error: "Watch something first." }, { status: 400 });
    const asOf = new Date(first.takenAt.getTime() + 7 * 24 * 60 * 60 * 1000);
    const r = await recordSnapshot(repo, item, { ...seededWeek(first.summary), calls: [], failed: [] }, { calls: 0, now: asOf });
    return Response.json({ changes: r.changes.length });
  });
}
