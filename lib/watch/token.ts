import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Unsubscribe tokens (the digest, pipeline reminders): a person and a workspace, signed with the
 * server secret and the email's kind, so the link works without signing in, cannot be reused for
 * the other kind, and nothing secret is stored.
 */
export type EmailKind = "digest" | "reminders";
type Env = Record<string, string | undefined>;

function secret(env: Env = process.env): string {
  const s = env.AUTH_SECRET?.trim();
  if (s) return s;
  if (env.VERCEL_ENV) throw new Error("AUTH_SECRET is required to sign unsubscribe links.");
  return "local-digest-signing-key-not-a-secret";
}

const sign = (payload: string, env?: Env, kind: EmailKind = "digest") => createHmac("sha256", secret(env)).update(`${kind}-unsubscribe:${payload}`).digest("base64url");

export function unsubscribeToken(workspaceId: string, userId: string, env?: Env, kind: EmailKind = "digest"): string {
  const payload = Buffer.from(`${workspaceId}:${userId}`).toString("base64url");
  return `${payload}.${sign(payload, env, kind)}`;
}

export function readUnsubscribeToken(token: string, env?: Env, kind: EmailKind = "digest"): { workspaceId: string; userId: string } | null {
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload, env, kind));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const [workspaceId, userId] = Buffer.from(payload, "base64url").toString("utf8").split(":");
  return workspaceId && userId ? { workspaceId, userId } : null;
}
