import { needFeature } from "@/lib/workspace/gate";
import { searchCity } from "@/lib/data/service";
import { inDataset, readJson } from "@/lib/workspace/route";

type Ctx = { params: Promise<{ id: string }> };

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * POST {rawCity, rawCountry, cityId} sets the city for every row with that name; cityId null skips
 * them. POST {rawCity, rawCountry, search} returns the cities a different spelling matches.
 */
export async function POST(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  const body = await readJson(req);
  const rawCity = str(body.rawCity, 120);
  const rawCountry = typeof body.rawCountry === "string" ? body.rawCountry : null;
  if (!rawCity) return Response.json({ error: "Which city?" }, { status: 400 });
  return inDataset(id, async ({ repo }) => {
    await needFeature(repo, "data.uploads");
    if (typeof body.search === "string") return Response.json({ options: searchCity(str(body.search, 120), rawCountry) });
    const cityId = typeof body.cityId === "string" && /^\d{1,12}$/.test(body.cityId) ? body.cityId : null;
    await repo.datasets.resolveCity(id, rawCity, rawCountry, cityId);
    return Response.json({ ok: true });
  });
}
