import "server-only";

import { resolveTxt } from "node:dns/promises";

import { isPrimaryHost } from "./hosts";

/**
 * A custom domain for shared plans and widgets: a hostname the workspace controls, proven by a TXT
 * record at _takeover.<domain> with the value takeover-verify=<token>. The domain must also be
 * added to the Vercel project (a manual step, or the Vercel API with a token).
 */
const HOST = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normaliseDomain(input: string): { domain: string } | { error: string } {
  const d = input.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/\.$/, "");
  if (!d) return { error: "Type a domain, e.g. plans.yourcompany.com." };
  if (!HOST.test(d)) return { error: "That isn't a domain name, e.g. plans.yourcompany.com." };
  if (isPrimaryHost(d)) return { error: "Use a domain your company owns, not Takeover's." };
  return { domain: d };
}

export const txtName = (domain: string) => `_takeover.${domain}`;
export const txtValue = (token: string) => `takeover-verify=${token}`;

export async function verifyDomain(domain: string, token: string, resolve: (name: string) => Promise<string[][]> = resolveTxt): Promise<boolean> {
  try {
    const records = await resolve(txtName(domain));
    return records.some((r) => r.join("") === txtValue(token));
  } catch {
    return false;
  }
}

/** Origins allowed to frame widgets: https origins only (http for localhost), at most 10. */
export function normaliseOrigins(lines: string): { origins: string[] } | { error: string } {
  const out: string[] = [];
  for (const raw of lines.split(/[\s,]+/).filter(Boolean)) {
    let u: URL;
    try {
      u = new URL(raw);
    } catch {
      return { error: `“${raw}” is not a site address, e.g. https://www.yourcompany.com.` };
    }
    if (u.protocol !== "https:" && !(u.protocol === "http:" && u.hostname === "localhost")) return { error: `Use https for ${u.host}.` };
    out.push(u.origin);
  }
  if (out.length > 10) return { error: "Up to 10 sites." };
  return { origins: [...new Set(out)] };
}
