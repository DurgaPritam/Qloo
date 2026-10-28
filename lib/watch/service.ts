import "server-only";

import { withBudget } from "@/lib/agent/budget";
import { metroCity, searchCity } from "@/lib/data/service";
import type { WorkspaceRepo } from "@/lib/db/scoped";
import { InputError } from "@/lib/db/scoped";
import type { CityOption } from "@/lib/data/types";
import { diffSnapshots, type WatchChange } from "@/lib/engine/watch";
import type { Entity } from "@/lib/engine/types";
import { sendEmail } from "@/lib/email/mailer";
import { enqueue, queueMode, staggerSeconds } from "@/lib/jobs/queue";
import { workspaceUsage, type QlooScope } from "@/lib/qloo/allowance";
import { QLOO_RUN_BUDGET } from "@/lib/qloo/client";
import { BudgetExceededError, budgetLimitText } from "@/lib/qloo/errors";
import type { QlooSource } from "@/lib/qloo/source";
import { findAct } from "@/lib/roster/resolve";
import type { Choice } from "@/lib/tools/shared";
import { can, ForbiddenError } from "@/lib/workspace/permissions";

import { digestEmail, digestLines, sendDigests, unsubscribeUrls, weekOf } from "./digest";
import { citySnapshot, fanbaseSnapshot, SNAPSHOT_CALLS, type SnapshotSummary } from "./snapshot";
import { alertText, tagFor } from "./wording";

/** Snapshots are weekly; the job runs every Monday and takes whatever is due. */
export const WATCH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
export const FIRST_SNAPSHOT_NOTE = "First snapshot taken; changes appear next week.";

/**
 * When an item is next due: the start of the next Monday (UTC), when the weekly job runs, but at
 * least four days away, so two snapshots are never days apart.
 */
export function nextCheck(now: Date): Date {
  const day = now.getUTCDay();
  const monday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + ((8 - day) % 7 || 7)));
  return monday.getTime() - now.getTime() < 4 * 24 * 60 * 60 * 1000 ? new Date(monday.getTime() + WATCH_INTERVAL_MS) : monday;
}

type Item = NonNullable<Awaited<ReturnType<WorkspaceRepo["watch"]["item"]>>>;

export type AddResult =
  | { status: "added" | "already"; id: string; name: string; note: string }
  | { status: "choose"; question: string; choices: Choice[] }
  | { status: "chooseCity"; options: CityOption[] }
  | { status: "none" };

/**
 * Watches a fanbase (resolved like a plan's first step, with the picker) or a city (matched to a
 * GeoNames metro). The first snapshot is taken now when the budget allows; otherwise the weekly
 * job takes it.
 */
export async function addWatch(
  repo: WorkspaceRepo,
  input: { kind: "fanbase" | "city"; query: string; entityId?: string; cityId?: string },
  deps: { source: QlooSource; now?: Date },
): Promise<AddResult> {
  if (!can(repo.context.role, "watch.edit")) throw new ForbiddenError("watch.edit");
  const scope: QlooScope = { kind: "workspace", workspaceId: repo.context.workspaceId };
  let added: { id: string; added: boolean; name: string };
  if (input.kind === "fanbase") {
    const found = await findAct(input.query, input.entityId, deps.source, scope);
    if (found.status === "choose") return { status: "choose", question: found.question, choices: found.choices };
    if (found.status === "none") return { status: "none" };
    const e = found.entity;
    const r = await repo.watch.add({ kind: "fanbase", targetId: e.id, name: e.name, detail: e.category, entity: e });
    added = { ...r, name: e.name };
  } else {
    const city = input.cityId ? metroCity(input.cityId) : undefined;
    let target = city;
    if (!target) {
      const options = searchCity(input.query, null);
      if (!options.length) return { status: "none" };
      if (options.length > 1) return { status: "chooseCity", options };
      target = metroCity(options[0].id);
    }
    if (!target) return { status: "none" };
    const r = await repo.watch.add({ kind: "city", targetId: target.id, name: target.name, detail: target.country });
    added = { ...r, name: target.name };
  }
  if (!added.added) return { status: "already", id: added.id, name: added.name, note: "Already on the watchlist." };

  const item = (await repo.watch.item(added.id))!;
  const usage = await workspaceUsage(repo.context.workspaceId);
  const calls = SNAPSHOT_CALLS[item.kind];
  if (usage.remaining < calls || (usage.dailyRemaining !== null && usage.dailyRemaining < calls)) {
    const note = "Added. The first snapshot waits for Monday's check: not enough Qloo calls left now.";
    await repo.watch.setChecked(item.id, { lastNote: note });
    return { status: "added", id: item.id, name: item.name, note };
  }
  const result = await checkItem(repo, item, { source: deps.source, scope, now: deps.now ?? new Date() });
  return { status: "added", id: item.id, name: item.name, note: result.note };
}

function snapshotFor(item: Item, source: QlooSource, opts: { runId: string; scope: QlooScope }): Promise<SnapshotSummary> {
  if (item.kind === "fanbase") {
    if (!item.entity) throw new InputError("This watch has no fanbase.");
    return fanbaseSnapshot({ ...item.entity, popularity: item.entity.popularity ?? 0 } as Entity, source, opts);
  }
  const city = metroCity(item.targetId);
  if (!city) throw new InputError("This city is no longer in the city list.");
  return citySnapshot(city, source, opts);
}

/**
 * One check of one item: a snapshot now, compared with the previous one. The first snapshot never
 * alerts (one reading is not a trend); later ones alert on the changes diffSnapshots finds, with
 * wording filled from the diff.
 */
export async function checkItem(repo: WorkspaceRepo, item: Item, deps: { source: QlooSource; scope: QlooScope; now: Date }) {
  const runId = `watch-${crypto.randomUUID()}`;
  const source = withBudget(deps.source, runId, QLOO_RUN_BUDGET);
  const [previous] = await repo.watch.snapshots(item.id, 1);
  const summary = await snapshotFor(item, source, { runId, scope: deps.scope });
  const snapshotId = await repo.watch.addSnapshot(item.id, summary, source.used(), deps.now);
  let changes: WatchChange[] = [];
  if (previous) {
    changes = diffSnapshots(previous.summary, summary);
    await repo.watch.addAlerts(
      changes.map((c) => ({
        itemId: item.id,
        snapshotId,
        previousSnapshotId: previous.id,
        kind: c.kind,
        list: c.list,
        entityId: c.entityId,
        entityName: c.name,
        before: c.before,
        after: c.after,
        ...alertText(c, { name: item.name, kind: item.kind }),
        createdAt: deps.now,
      })),
    );
  }
  const failed = summary.failed.length ? ` Qloo did not answer for ${summary.failed.join(", ")}; those lists are compared next week.` : "";
  const note = previous ? `${changes.length ? `${changes.length} change${changes.length === 1 ? "" : "s"}` : "No changes"} since last week.${failed}` : `${FIRST_SNAPSHOT_NOTE}${failed}`;
  await repo.watch.setChecked(item.id, { lastSnapshotAt: deps.now, nextDueAt: nextCheck(deps.now), lastNote: note });
  return { snapshotId, first: !previous, changes, calls: source.used(), note };
}

const startOfNextMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
const startOfNextDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));

/**
 * The weekly job for one workspace: every due item, within its monthly allowance and the daily
 * cap (keeping the job reserve). An item that would not fit is skipped and says so, and is not
 * retried before the limit resets (next month, or tomorrow for the daily cap). Then the digest.
 */
export async function runWatchWorkspace(
  repo: WorkspaceRepo,
  deps: { source: QlooSource; now: Date; workspaceName: string; appUrl: string; jobId?: string },
) {
  const scope: QlooScope = { kind: "job", workspaceId: repo.context.workspaceId };
  const items = await repo.watch.due(deps.now);
  let calls = 0;
  let skipped = 0;
  let checked = 0;
  const notes: string[] = [];
  for (const item of items) {
    const need = SNAPSHOT_CALLS[item.kind];
    const usage = await workspaceUsage(repo.context.workspaceId);
    const limit =
      usage.remaining < need
        ? "workspace"
        : usage.dailyRemaining !== null && usage.dailyRemaining < need
          ? "daily"
          : usage.jobDailyRemaining !== null && usage.jobDailyRemaining < need
            ? "job_reserve"
            : null;
    if (limit) {
      skipped++;
      const until = limit === "workspace" ? startOfNextMonth(deps.now) : startOfNextDay(deps.now);
      await repo.watch.setChecked(item.id, {
        nextDueAt: until,
        lastNote: `Skipped: ${budgetLimitText(limit)} was reached. Checked again from ${until.toISOString().slice(0, 10)}.`,
      });
      continue;
    }
    try {
      const r = await checkItem(repo, item, { source: deps.source, scope, now: deps.now });
      calls += r.calls;
      checked++;
    } catch (err) {
      if (!(err instanceof BudgetExceededError)) throw err;
      skipped++;
      const until = err.limitName === "workspace" ? startOfNextMonth(deps.now) : startOfNextDay(deps.now);
      await repo.watch.setChecked(item.id, { nextDueAt: until, lastNote: `Skipped: ${err.message}. Checked again from ${until.toISOString().slice(0, 10)}.` });
    }
  }
  if (skipped) notes.push(`skipped: budget, ${skipped} item${skipped === 1 ? "" : "s"} not checked`);
  const sent = await sendDigests(repo, { workspaceName: deps.workspaceName, appUrl: deps.appUrl, now: deps.now });
  return { checked, skipped, calls, digests: sent.length, note: [`Checked ${checked} of ${items.length}, ${calls} Qloo calls`, ...notes, `${sent.length} digest${sent.length === 1 ? "" : "s"} sent`].join("; ") + "." };
}

/** "Send me a test": this week's digest to the person who clicked, whether or not they subscribed. */
export async function sendTestDigest(repo: WorkspaceRepo, input: { email: string; workspaceName: string; appUrl: string; now: Date }) {
  const alerts = await repo.watch.alerts({ since: new Date(input.now.getTime() - WATCH_INTERVAL_MS), limit: 8 });
  const lines = alerts.length ? await digestLines(alerts, null) : [{ tag: "", title: "Nothing moved yet", body: "Your watchlist has no changes this week. Changes need two weekly snapshots." }];
  const urls = unsubscribeUrls(input.appUrl, repo.context.workspaceId, repo.context.userId);
  await sendEmail({
    ...digestEmail({ to: input.email, workspaceName: input.workspaceName, weekOf: weekOf(input.now), lines, appUrl: input.appUrl, unsubscribeUrl: urls.page, oneClickUrl: urls.oneClick }),
    subject: `Test · Market watch · week of ${weekOf(input.now)}`,
  });
}

/** The weekly tick: one staggered job per workspace with something due. */
export async function scheduleWatchJobs(due: readonly { workspaceId: string; userId: string }[], asOf?: Date) {
  const stagger = staggerSeconds();
  if (queueMode() === "off") throw new Error("Background jobs are not set up on this deployment.");
  for (const [i, d] of due.entries()) {
    await enqueue({ kind: "watch.refresh", workspaceId: d.workspaceId, userId: d.userId, ...(asOf ? { asOf: asOf.toISOString() } : {}) }, i * stagger);
  }
  return due.length;
}

/** What the Market watch page shows. */
export async function watchView(repo: WorkspaceRepo, now = new Date()) {
  const items = await repo.watch.items();
  const latest = await Promise.all(items.map((i) => repo.watch.snapshots(i.id, 2)));
  const alerts = await repo.watch.alerts({ limit: 30 });
  return {
    items: items.map((i, n) => {
      const [curr, prev] = latest[n];
      return {
        id: i.id,
        kind: i.kind,
        name: i.name,
        detail: i.detail,
        lastSnapshotAt: i.lastSnapshotAt?.toISOString() ?? null,
        nextDueAt: i.nextDueAt?.toISOString() ?? null,
        note: i.lastNote,
        snapshots: latest[n].length,
        /** Current top lists with last week's rank and value beside each entry, when there was a last week. */
        lists: curr
          ? Object.entries(curr.summary.lists).map(([list, entries]) => ({
              list,
              entries: entries.slice(0, 5).map((e) => {
                const was = prev?.summary.lists[list]?.find((x) => x.id === e.id);
                return { ...e, before: was ? { rank: was.rank, value: was.value } : null };
              }),
            }))
          : [],
        calls: curr?.summary.calls ?? [],
        changes: curr ? alerts.filter((a) => a.itemId === i.id && a.createdAt >= curr.takenAt).length : 0,
      };
    }),
    alerts: alerts.map((a) => ({ ...a, tag: tagFor(a), createdAt: a.createdAt.toISOString() })),
    /** The alerts the next digest would carry: the last seven days'. */
    thisWeek: alerts.filter((a) => a.createdAt.getTime() >= now.getTime() - WATCH_INTERVAL_MS).map((a) => a.id),
  };
}

export type WatchView = Awaited<ReturnType<typeof watchView>>;
