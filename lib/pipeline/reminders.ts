import "server-only";

import type { WorkspaceRepo } from "@/lib/db/scoped";
import { sendEmail } from "@/lib/email/mailer";
import { queueMode, type PipelineRemindersMessage } from "@/lib/jobs/queue";
import { unsubscribeToken } from "@/lib/watch/token";
import { jobWorkspace } from "@/lib/workspace/session";

/**
 * Overdue pipeline cards: each card past its user-set due date reminds its owner once per date, in
 * the app; owners who turned reminder emails on also get one email listing theirs, with an
 * unsubscribe link. These go to the user themselves, never to a contact (rule 5).
 */

/** The date in a time zone, as YYYY-MM-DD (UTC when none or unknown). */
export function localDate(now: Date, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timeZone || "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

const appUrl = () => process.env.APP_URL?.trim().replace(/\/$/, "") || "http://localhost:3000";

export async function sendReminders(repo: WorkspaceRepo, input: { now: Date; appUrl: string }) {
  const workspace = await repo.workspace.get();
  const cards = await repo.pipeline.remindOverdue(localDate(input.now, workspace?.timeZone ?? null));
  const recipients = new Map((await repo.digest.reminderRecipients()).filter((r) => r.email).map((r) => [r.userId, r.email!]));
  const byOwner = new Map<string, typeof cards>();
  for (const c of cards) byOwner.set(c.ownerId, [...(byOwner.get(c.ownerId) ?? []), c]);
  const emailed: string[] = [];
  for (const [ownerId, list] of byOwner) {
    const to = recipients.get(ownerId);
    if (!to) continue;
    const token = unsubscribeToken(repo.context.workspaceId, ownerId, undefined, "reminders");
    const unsubscribe = `${input.appUrl}/unsubscribe/reminders?token=${encodeURIComponent(token)}`;
    const lines = list.map((c) => `- ${c.recipient} (${c.context}): follow-up was due ${c.dueDate}. ${input.appUrl}/workspace/pipeline?card=${c.id}`);
    await sendEmail({
      to,
      subject: `${list.length} pipeline follow-up${list.length === 1 ? "" : "s"} overdue in ${workspace?.name ?? "your workspace"}`,
      text: [`These outreach cards you own are past the follow-up date you set:`, "", ...lines, "", `Stop these emails: ${unsubscribe}`].join("\n"),
      html: `<p>These outreach cards you own are past the follow-up date you set:</p><ul>${list
        .map((c) => `<li><a href="${input.appUrl}/workspace/pipeline?card=${c.id}">${escape(c.recipient)}</a> (${escape(c.context)}): due ${c.dueDate}</li>`)
        .join("")}</ul><p style="font-size:12px"><a href="${unsubscribe}">Stop these emails</a></p>`,
      headers: { "List-Unsubscribe": `<${unsubscribe}>` },
    });
    emailed.push(ownerId);
  }
  return { reminded: cards.length, emailed };
}

const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function runRemindersJob(message: PipelineRemindersMessage): Promise<void> {
  const now = message.asOf && queueMode() === "local" ? new Date(message.asOf) : new Date();
  const found = await jobWorkspace(message.workspaceId, message.userId);
  if (!found) return;
  const jobId = await found.repo.jobs.create({ kind: "pipeline.reminders", targetId: message.workspaceId, status: "running" });
  try {
    const r = await sendReminders(found.repo, { now, appUrl: appUrl() });
    await found.repo.jobs.update(jobId, { status: "done", qlooCalls: 0, note: `${r.reminded} reminder${r.reminded === 1 ? "" : "s"}, ${r.emailed.length} email${r.emailed.length === 1 ? "" : "s"}`, finishedAt: new Date() });
  } catch (err) {
    console.error("[jobs] pipeline reminders failed:", err instanceof Error ? err.name : "unknown");
    await found.repo.jobs.update(jobId, { status: "failed", note: "Reminders failed; the next hourly tick tries again.", finishedAt: new Date() });
  }
}
