import { needFeature } from "@/lib/workspace/gate";
import { datasetView, deleteDataset, fanbaseCityScores } from "@/lib/data/service";
import { getFileStore } from "@/lib/files/store";
import { getQlooSource } from "@/lib/qloo/source";
import { inDataset } from "@/lib/workspace/route";

type Ctx = { params: Promise<{ id: string }> };

/** GET → the dataset page's data. DELETE → removes the dataset, its rows and its file. */
export async function GET(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return inDataset(id, async ({ repo, ctx }) => {
    const view = await datasetView(repo, id, async (entity) => {
      await needFeature(repo, "data.uploads");
      return fanbaseCityScores(repo, entity, getQlooSource(), { kind: "workspace", workspaceId: ctx.workspaceId });
    });
    return Response.json(view);
  });
}

export async function DELETE(_req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return inDataset(id, async ({ repo }) => {
    await deleteDataset(repo, id, getFileStore());
    return Response.json({ ok: true });
  });
}
