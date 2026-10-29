/**
 * Which hosts are Takeover's own, and what a workspace's custom domain may serve: only branded
 * shared plans (/p/…), widgets (/embed/…) and the static files they need. No database: the proxy
 * uses this before any page runs.
 */
type Env = Record<string, string | undefined>;

export function primaryHosts(env: Env = process.env): string[] {
  const hosts = ["localhost", "127.0.0.1"];
  for (const v of [env.APP_URL, env.VERCEL_URL, env.VERCEL_PROJECT_PRODUCTION_URL, env.VERCEL_BRANCH_URL]) {
    const h = v?.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "").toLowerCase();
    if (h) hosts.push(h);
  }
  return hosts;
}

export function isPrimaryHost(host: string, env: Env = process.env): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return primaryHosts(env).includes(h) || h.endsWith(".vercel.app");
}

const ALLOWED = [/^\/p\/[0-9a-f-]{36}\/?$/, /^\/embed\//, /^\/_next\//, /^\/api\/votes$/, /^\/favicon/, /^\/icon/, /^\/robots\.txt$/];

export function allowedOnCustomDomain(path: string): boolean {
  return ALLOWED.some((re) => re.test(path));
}
