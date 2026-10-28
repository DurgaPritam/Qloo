import { inWorkspace, readJson } from "@/lib/workspace/route";

/** GET → the current workspace's rosters. POST {name} → a new, empty roster. */
export async function GET(): Promise<Response> {
  return inWorkspace(async ({ repo }) => Response.json({ rosters: await repo.rosters.list() }));
}

export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inWorkspace(async ({ repo }) => {
    const id = await repo.rosters.create(typeof body.name === "string" ? body.name : "");
    return Response.json({ id });
  });
}
