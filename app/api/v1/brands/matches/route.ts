import { brandMatches } from "@/lib/api/endpoints";
import { v1 } from "@/lib/api/v1";

export const maxDuration = 30;

/** GET /api/v1/brands/matches?q= → talent, shows and podcasts a brand's fans over-index on. */
export async function GET(req: Request): Promise<Response> {
  return v1(req, "/brands/matches", (c) => brandMatches(c, new URL(req.url).searchParams));
}
