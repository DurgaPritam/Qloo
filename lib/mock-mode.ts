/**
 * Mock mode serves sample data instead of Qloo. It is opt-in (TAKEOVER_MOCK=1) and forbidden in
 * Vercel production, checked at build time (next.config.ts) and again at runtime.
 * No "server-only" import: next.config.ts loads this file.
 */

export const MOCK_BANNER = "SAMPLE DATA — not Qloo results";

type Env = Record<string, string | undefined>;

export function isMockMode(env: Env = process.env): boolean {
  return env.TAKEOVER_MOCK === "1";
}

export function assertMockAllowed(env: Env = process.env): void {
  if (isMockMode(env) && env.VERCEL_ENV === "production") {
    throw new Error(
      "TAKEOVER_MOCK=1 is not allowed when VERCEL_ENV=production. Sample data must never reach judges.",
    );
  }
}
