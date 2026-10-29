import { checklistView } from "@/lib/onboarding/checklist";
import { inWorkspace } from "@/lib/workspace/route";

/** GET → the getting-started checklist, ticked from the workspace's data. POST → dismisses it for the workspace. */
export async function GET(): Promise<Response> {
  return inWorkspace(async ({ repo }) => Response.json(await checklistView(repo), { headers: { "Cache-Control": "no-store" } }));
}

export async function POST(): Promise<Response> {
  return inWorkspace(async ({ repo }) => {
    await repo.workspace.dismissChecklist();
    return Response.json({ ok: true });
  });
}
