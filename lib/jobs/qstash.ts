import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** Seconds of clock difference allowed when checking a signature's times. */
const CLOCK_SKEW_S = 60;

const b64url = (buf: Buffer) => buf.toString("base64url");

/**
 * Checks QStash's Upstash-Signature header: an HS256 JWT signed with the current or next signing
 * key, issued by Upstash, for this URL, in date, and carrying the SHA-256 of this exact body.
 * Written against node:crypto so the job routes need no extra package.
 */
export function verifyQstashSignature(
  signature: string | null,
  body: string,
  input: { url: string; keys: readonly (string | undefined)[]; now?: number },
): boolean {
  if (!signature) return false;
  const parts = signature.split(".");
  if (parts.length !== 3) return false;
  const [h, p, sig] = parts;

  let header: { alg?: string };
  let claims: { iss?: string; sub?: string; exp?: number; nbf?: number; body?: string };
  try {
    header = JSON.parse(Buffer.from(h, "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (header.alg !== "HS256") return false;

  const given = Buffer.from(sig, "base64url");
  const signed = input.keys.some((key) => {
    if (!key) return false;
    const expected = createHmac("sha256", key).update(`${h}.${p}`).digest();
    return expected.length === given.length && timingSafeEqual(expected, given);
  });
  if (!signed) return false;

  const now = Math.floor((input.now ?? Date.now()) / 1000);
  if (claims.iss !== "Upstash") return false;
  if (claims.sub !== input.url) return false;
  if (typeof claims.exp !== "number" || claims.exp + CLOCK_SKEW_S < now) return false;
  if (typeof claims.nbf === "number" && claims.nbf - CLOCK_SKEW_S > now) return false;
  const bodyHash = b64url(createHash("sha256").update(body).digest());
  return (claims.body ?? "").replace(/=+$/, "") === bodyHash;
}

/** Test helper and reference: what QStash sends for a body. */
export function signQstash(body: string, input: { url: string; key: string; now?: number; ttlS?: number }): string {
  const now = Math.floor((input.now ?? Date.now()) / 1000);
  const enc = (o: object) => b64url(Buffer.from(JSON.stringify(o)));
  const h = enc({ alg: "HS256", typ: "JWT" });
  const p = enc({
    iss: "Upstash",
    sub: input.url,
    exp: now + (input.ttlS ?? 300),
    nbf: now,
    iat: now,
    jti: crypto.randomUUID(),
    body: b64url(createHash("sha256").update(body).digest()),
  });
  return `${h}.${p}.${b64url(createHmac("sha256", input.key).update(`${h}.${p}`).digest())}`;
}

/** Publishes a JSON message to one of our routes, delivered after `delaySeconds`. */
export async function publishQstash(
  destination: string,
  body: unknown,
  input: { token: string; delaySeconds: number; baseUrl?: string; fetch?: typeof fetch },
): Promise<void> {
  const base = (input.baseUrl ?? "https://qstash.upstash.io").replace(/\/$/, "");
  const res = await (input.fetch ?? fetch)(`${base}/v2/publish/${destination}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.token}`,
      "Content-Type": "application/json",
      "Upstash-Delay": `${Math.max(0, Math.round(input.delaySeconds))}s`,
      // Our job routes record failures themselves and answer 200; retries cover crashes only.
      "Upstash-Retries": "2",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`QStash publish failed with ${res.status}`);
}
