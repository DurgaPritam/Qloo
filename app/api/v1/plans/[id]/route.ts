import { getPlan } from "@/lib/api/endpoints";
import { v1 } from "@/lib/api/v1";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/plans/{id} → queued, running, failed, or the finished plan with its evidence. */
export async function GET(req: Request, { params }: Ctx): Promise<Response> {
  const { id } = await params;
  return v1(req, "/plans/{id}", (c) => getPlan(c, id));
}
