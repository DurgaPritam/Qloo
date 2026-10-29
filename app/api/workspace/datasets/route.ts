import { ingest } from "@/lib/data/service";
import { MAX_FILE_BYTES } from "@/lib/data/table";
import type { ColumnRole } from "@/lib/data/types";
import { FilesNotConfiguredError, getFileStore } from "@/lib/files/store";
import { getLimiters, isE2eRequest, visitorId } from "@/lib/server/rate-limit";
import { inFeature } from "@/lib/workspace/route";

/**
 * POST multipart {file, mapping} → reads the file on the server, matches cities, stores the file
 * privately and the rows with source "user". The mapping comes from the browser's preview step.
 */
export async function POST(req: Request): Promise<Response> {
  return inFeature("data.uploads", async ({ repo }) => {
    const form = await req.formData().catch(() => null);
    const file = form?.get("file");
    const mappingText = form?.get("mapping");
    if (!(file instanceof File) || typeof mappingText !== "string") return Response.json({ error: "Send the file and its column mapping." }, { status: 400 });
    if (file.size > MAX_FILE_BYTES) return Response.json({ error: "The file is over 5 MB." }, { status: 413 });
    if (!isE2eRequest(req.headers)) {
      const limit = await getLimiters().tools.check(visitorId(req.headers));
      if (!limit.ok) return Response.json({ error: "Too many uploads this hour. Try again later." }, { status: 429 });
    }
    let mapping: Record<string, ColumnRole>;
    try {
      mapping = JSON.parse(mappingText) as Record<string, ColumnRole>;
    } catch {
      return Response.json({ error: "The column mapping is not valid." }, { status: 400 });
    }
    let store;
    try {
      store = getFileStore();
    } catch (err) {
      if (err instanceof FilesNotConfiguredError) return Response.json({ error: "Uploads are not set up on this deployment yet." }, { status: 503 });
      throw err;
    }
    const result = await ingest(repo, { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), mapping }, store);
    return Response.json(result);
  });
}
