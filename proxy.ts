import { NextResponse, type NextRequest } from "next/server";

import { allowedOnCustomDomain, isPrimaryHost } from "@/lib/white-label/hosts";

/**
 * On a workspace's custom domain, only its branded shared plans and widgets are served; everything
 * else (the app, sign-in, the API) answers 404 there, so a white-label domain can never show the
 * workspace's private pages or another workspace's plans.
 */
export function proxy(req: NextRequest) {
  const host = req.headers.get("host") ?? "";
  if (!host || isPrimaryHost(host)) return NextResponse.next();
  if (allowedOnCustomDomain(req.nextUrl.pathname)) return NextResponse.next();
  return new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain" } });
}

export const config = { matcher: "/((?!_next/static|_next/image).*)" };
