/** Where Enterprise enquiries go: CONTACT_EMAIL; locally, the dev outbox. Null when unset in production. */
export function contactAddress(env: Record<string, string | undefined> = process.env): string | null {
  const set = env.CONTACT_EMAIL?.trim();
  if (set) return set;
  return env.VERCEL_ENV ? null : "enterprise@takeover.local";
}
