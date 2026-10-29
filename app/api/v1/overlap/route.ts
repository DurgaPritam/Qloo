import { overlap } from "@/lib/api/endpoints";
import { v1 } from "@/lib/api/v1";

export const maxDuration = 30;

/** GET /api/v1/overlap?a=&b= → how strongly each fanbase over-indexes on the other, and where both are strong. */
export async function GET(req: Request): Promise<Response> {
  return v1(req, "/overlap", (c) => overlap(c, new URL(req.url).searchParams));
}
