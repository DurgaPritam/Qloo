import "server-only";

/**
 * The only module that sends email. It sends through Resend when
 * RESEND_API_KEY is set. Without it, local runs and e2e put messages in an in-memory outbox
 * (shown at /dev/outbox); on Vercel there is no outbox, and sending fails closed.
 */

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, e.g. List-Unsubscribe on the digest. */
  headers?: Record<string, string>;
}

export interface OutboxMessage extends Email {
  at: string;
}

type Env = Record<string, string | undefined>;

/** Never on Vercel (preview or production): the outbox shows sign-in links. */
export const outboxEnabled = (env: Env = process.env) => !env.RESEND_API_KEY?.trim() && !env.VERCEL_ENV;

export const emailConfigured = (env: Env = process.env) => Boolean(env.RESEND_API_KEY?.trim() && env.EMAIL_FROM?.trim()) || outboxEnabled(env);

const shared = globalThis as typeof globalThis & { __takeoverOutbox?: OutboxMessage[] };
const outbox = (shared.__takeoverOutbox ??= []);

export function readOutbox(to?: string): OutboxMessage[] {
  if (!outboxEnabled()) return [];
  return outbox.filter((m) => !to || m.to.toLowerCase() === to.toLowerCase()).slice().reverse();
}

export class EmailNotConfiguredError extends Error {
  constructor() {
    super("Email isn't configured: set RESEND_API_KEY and EMAIL_FROM.");
    this.name = "EmailNotConfiguredError";
  }
}

export async function sendEmail(email: Email): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (key) {
    const from = process.env.EMAIL_FROM?.trim();
    if (!from) throw new EmailNotConfiguredError();
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: email.to, subject: email.subject, text: email.text, html: email.html, ...(email.headers ? { headers: email.headers } : {}) }),
    });
    // The response body can echo the request; log the status only.
    if (!res.ok) throw new Error(`Resend refused the email (HTTP ${res.status}).`);
    return;
  }
  if (!outboxEnabled()) throw new EmailNotConfiguredError();
  outbox.push({ ...email, at: new Date().toISOString() });
  if (outbox.length > 100) outbox.shift();
}

export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A plain message with one button: sign-in links and invitations. */
export function linkEmail({ to, subject, intro, button, url, outro }: { to: string; subject: string; intro: string; button: string; url: string; outro: string }): Email {
  return {
    to,
    subject,
    text: `${intro}\n\n${button}: ${url}\n\n${outro}`,
    html: `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1d1b26">
<p>${escapeHtml(intro)}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;background:#1d1b26;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none">${escapeHtml(button)}</a></p>
<p style="color:#6b6878">${escapeHtml(outro)}</p></div>`,
  };
}
