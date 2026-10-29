import { fanbaseCities } from "@/lib/api/endpoints";
import { v1 } from "@/lib/api/v1";

export const maxDuration = 30;

/** GET /api/v1/fanbases/cities?q= → the fanbase's strongest cities, market by market. */
export async function GET(req: Request): Promise<Response> {
  return v1(req, "/fanbases/cities", (c) => fanbaseCities(c, new URL(req.url).searchParams));
}
