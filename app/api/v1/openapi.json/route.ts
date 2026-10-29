import { openApiSpec } from "@/lib/api/openapi";
import { appOrigin } from "@/lib/workspace/route";

/** GET /api/v1/openapi.json → the API description (no key needed). */
export async function GET(req: Request): Promise<Response> {
  return Response.json(openApiSpec(appOrigin(req)), { headers: { "Access-Control-Allow-Origin": "*" } });
}
