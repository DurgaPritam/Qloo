import { unsubscribeDigest } from "@/lib/workspace/session";

/**
 * One-click unsubscribe (RFC 8058): mail clients POST here from the digest's List-Unsubscribe
 * header. The token is signed for one person and one workspace; nothing else is needed.
 */
export async function POST(req: Request): Promise<Response> {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const ok = await unsubscribeDigest(token);
  return Response.json(ok ? { ok: true } : { error: "That unsubscribe link is not valid." }, { status: ok ? 200 : 400 });
}
