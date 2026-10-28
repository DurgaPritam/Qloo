import { inWorkspace } from "@/lib/workspace/route";

/** GET ?q= → plans, rosters, talent, watches and data in the current workspace whose names match. */
export async function GET(req: Request): Promise<Response> {
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim();
  return inWorkspace(async ({ repo }) => Response.json({ results: q.length < 2 ? [] : await repo.search(q) }));
}
