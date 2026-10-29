import { venues } from "@/lib/api/endpoints";
import { v1 } from "@/lib/api/v1";

export const maxDuration = 30;

/** GET /api/v1/venues?city=&kinds= → who people in a city over-index on, to book. */
export async function GET(req: Request): Promise<Response> {
  return v1(req, "/venues", (c) => venues(c, new URL(req.url).searchParams));
}
