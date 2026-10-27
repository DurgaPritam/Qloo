import { connection } from "next/server";

import { posterImage } from "@/lib/og";
import { loadLineup } from "@/lib/tools/lineup";

/** GET → the lineup's poster as a PNG download. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  await connection();
  const l = await loadLineup((await params).id);
  if (!l) return new Response("Not found", { status: 404 });
  const img = await posterImage({
    title: l.title,
    headliner: l.headliner.name,
    acts: l.acts.map((a) => a.name),
    host: l.host?.name ?? null,
    city: l.city?.name ?? null,
    venue: l.venue,
    crowdFit: l.crowdFit,
  });
  const headers = new Headers(img.headers);
  headers.set("Content-Disposition", `attachment; filename="takeover-lineup-${l.id.slice(0, 8)}.png"`);
  return new Response(img.body, { headers });
}
