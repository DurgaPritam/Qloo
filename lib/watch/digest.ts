import "server-only";

import type { WorkspaceRepo } from "@/lib/db/scoped";
import { escapeHtml, sendEmail, type Email } from "@/lib/email/mailer";
import { MAX_OUTPUT_TOKENS } from "@/lib/llm";
import type { LLMProvider } from "@/lib/llm/types";

import { unsubscribeToken } from "./token";
import { safeRephrase, tagFor } from "./wording";

/**
 * The weekly digest (docs/roadmap-rules.md, rule 5): email to the person themselves, only after
 * they turned it on, with an unsubscribe link that works without signing in. The link carries a
 * signed token for that person and workspace, so nothing secret is stored.
 */
export interface DigestLine {
  tag: string;
  title: string;
  body: string;
}

type AlertRow = Awaited<ReturnType<WorkspaceRepo["watch"]["alerts"]>>[number];

/**
 * The lines of a digest from this week's alerts: their templated text, optionally rephrased by the
 * model through lib/llm, and kept only if the rephrasing adds no fact (safeRephrase).
 */
export async function digestLines(alerts: readonly AlertRow[], model: LLMProvider | null): Promise<DigestLine[]> {
  const lines: DigestLine[] = alerts.map((a) => ({ tag: tagFor(a), title: a.title, body: a.body }));
  if (!model || !lines.length) return lines;
  const out: DigestLine[] = [];
  for (const [i, l] of lines.entries()) {
    const names = [alerts[i].entityName, alerts[i].itemName];
    try {
      const res = await model.complete(
        `Rephrase this alert sentence so it reads naturally in an email. Keep every name and number exactly as written, add nothing, and reply with the sentence only.\n\n${l.body}`,
        { maxOutputTokens: Math.min(200, MAX_OUTPUT_TOKENS.completion) },
      );
      out.push({ ...l, body: res.refused ? l.body : safeRephrase(l.body, res.text, names) });
    } catch {
      out.push(l);
    }
  }
  return out;
}

/** The page a person opens from the email, and the endpoint mail clients POST to for one-click unsubscribe. */
export function unsubscribeUrls(appUrl: string, workspaceId: string, userId: string) {
  const token = encodeURIComponent(unsubscribeToken(workspaceId, userId));
  return { page: `${appUrl}/unsubscribe/digest?token=${token}`, oneClick: `${appUrl}/api/digest/unsubscribe?token=${token}` };
}

export function digestEmail(input: { to: string; workspaceName: string; weekOf: string; lines: DigestLine[]; appUrl: string; unsubscribeUrl: string; oneClickUrl: string }): Email {
  const { lines } = input;
  const n = lines.length;
  const subject = `Market watch · week of ${input.weekOf} · ${n} change${n === 1 ? "" : "s"}`;
  const intro = `${n} thing${n === 1 ? "" : "s"} moved on ${input.workspaceName}'s watchlist this week.`;
  const outro = "Every change is Qloo signal, compared with last week's snapshot. Manage alerts in Market watch.";
  const text = [intro, "", ...lines.map((l) => `${l.title}. ${l.body}`), "", outro, `Market watch: ${input.appUrl}/workspace/watch`, "", `Unsubscribe: ${input.unsubscribeUrl}`].join("\n");
  const html = `<div style="font-family:Inter,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1d1b26">
<p>${escapeHtml(intro)}</p>
${lines.map((l) => `<p><strong>${escapeHtml(l.title)}.</strong> ${escapeHtml(l.body)}</p>`).join("\n")}
<p style="color:#6b6878">${escapeHtml(outro)} <a href="${escapeHtml(`${input.appUrl}/workspace/watch`)}">Open Market watch</a></p>
<p style="color:#6b6878;font-size:12px"><a href="${escapeHtml(input.unsubscribeUrl)}">Unsubscribe from this digest</a></p></div>`;
  return {
    to: input.to,
    subject,
    text,
    html,
    headers: { "List-Unsubscribe": `<${input.oneClickUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

export const weekOf = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/**
 * Sends this week's digest to each member who turned it on, if anything changed since their last
 * one (at most 7 days back). Returns who got it. Nobody else is ever emailed.
 */
export async function sendDigests(repo: WorkspaceRepo, input: { workspaceName: string; appUrl: string; now: Date; model?: LLMProvider | null; only?: string }) {
  const recipients = (await repo.digest.recipients()).filter((r) => r.email && (!input.only || r.userId === input.only));
  const weekAgo = new Date(input.now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const alerts = await repo.watch.alerts({ since: weekAgo, limit: 20 });
  if (!alerts.length || !recipients.length) return [];
  const lines = await digestLines(alerts.slice(0, 8), input.model ?? null);
  const sent: string[] = [];
  for (const r of recipients) {
    const urls = unsubscribeUrls(input.appUrl, repo.context.workspaceId, r.userId);
    await sendEmail(digestEmail({ to: r.email!, workspaceName: input.workspaceName, weekOf: weekOf(input.now), lines, appUrl: input.appUrl, unsubscribeUrl: urls.page, oneClickUrl: urls.oneClick }));
    sent.push(r.userId);
  }
  await repo.digest.markSent(sent, input.now);
  return sent;
}
