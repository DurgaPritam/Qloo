import "server-only";

import { withBudget } from "@/lib/agent/budget";
import type { WorkspaceRepo } from "@/lib/db/scoped";
import { InputError } from "@/lib/db/scoped";
import { CATEGORY_LABEL } from "@/lib/engine/explain";
import { isComedian } from "@/lib/engine/match";
import { scoreRosterPairs, type RosterActSignal } from "@/lib/engine/roster";
import type { Entity } from "@/lib/engine/types";
import { enqueue, queueMode, staggerSeconds } from "@/lib/jobs/queue";
import { isMockMode } from "@/lib/mock-mode";
import { workspaceUsage, type QlooScope } from "@/lib/qloo/allowance";
import { BudgetExceededError, budgetLimitText } from "@/lib/qloo/errors";
import { getQlooSource, type QlooSource } from "@/lib/qloo/source";
import { describeFailure, metroPool } from "@/lib/tools/shared";
import { can, ForbiddenError } from "@/lib/workspace/permissions";

import { BATCH_CALLS, othersKey, pairingsStale, planRefresh, profileStale, refreshBlock, type PlanAct, type RefreshUnit } from "./plan";
import { profileAct } from "./profile";
import type { ActProfile, RefreshEstimate, RosterActView, RosterJobView, RosterView } from "./types";

type ActRow = Awaited<ReturnType<WorkspaceRepo["rosters"]["acts"]>>[number];

/** Live and sample profiles never share a cache entry. */
export const profileKey = (entityId: string, mock: boolean) => `${mock ? "mock" : "live"}:${entityId}`;

const entityOf = (act: ActRow): Entity => ({ ...act.entity, popularity: act.entity.popularity ?? 0 });

/** "Comedian", "Music artist", "Podcast"… */
export function actKind(act: Pick<ActRow, "type" | "entity">): string {
  if (act.type === "person" && isComedian(entityOf(act as ActRow))) return "Comedian";
  if (act.type === "artist") return "Music artist";
  const label = CATEGORY_LABEL[act.type];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** The roster's acts with their cached profiles, for this source (live or sample). */
async function load(repo: WorkspaceRepo, rosterId: string, mock: boolean) {
  const roster = await repo.rosters.get(rosterId);
  if (!roster) return null;
  const acts = await repo.rosters.acts(rosterId);
  const rows = await repo.entityProfiles.get(acts.map((a) => profileKey(a.qlooEntityId, mock)));
  const profiles = new Map(rows.map((r) => [r.entityId, { profile: r.profile, at: r.refreshedAt }]));
  const planActs: PlanAct[] = acts.map((a) => ({
    id: a.id,
    entityId: a.qlooEntityId,
    category: a.type,
    profileAt: profiles.get(a.qlooEntityId)?.at ?? null,
    affinitiesFor: a.affinitiesFor,
    affinitiesAt: a.affinitiesAt,
  }));
  return { roster, acts, profiles, planActs };
}

export interface BatchResult {
  calls: number;
  profiled: number;
  paired: number;
  /** Units not done because a budget ran out. */
  skipped: number;
  budget: BudgetExceededError | null;
  notes: string[];
}

/**
 * Runs one batch of a refresh: profiles (lib/roster/profile.ts) and pairings, one Qloo call per
 * act and category with the other acts as filter.results.entities. The acts are read again here,
 * so an act added or removed since the refresh was planned is handled. A budget error stops the
 * batch; other failures are noted and the act keeps its previous data.
 */
export async function runBatch(
  repo: WorkspaceRepo,
  rosterId: string,
  units: readonly RefreshUnit[],
  input: { source: QlooSource; scope: QlooScope; fresh: boolean; now?: () => Date },
): Promise<BatchResult> {
  const now = input.now ?? (() => new Date());
  const runId = `roster-${crypto.randomUUID()}`;
  const source = withBudget(input.source, runId, BATCH_CALLS);
  const opts = { runId, scope: input.scope, fresh: input.fresh };
  const acts = await repo.rosters.acts(rosterId);
  const byId = new Map(acts.map((a) => [a.id, a]));
  const result: BatchResult = { calls: 0, profiled: 0, paired: 0, skipped: 0, budget: null, notes: [] };

  for (const [i, unit] of units.entries()) {
    const act = byId.get(unit.actId);
    if (!act) continue;
    try {
      if (unit.profile) {
        const profile = await profileAct(entityOf(act), source, opts);
        await repo.entityProfiles.put(profileKey(act.qlooEntityId, source.mock), profile, now());
        result.profiled++;
      }
      if (unit.pairings.length) {
        const paired = await pairActs(act, acts, source, opts);
        if (paired) {
          await repo.rosters.setAffinities(rosterId, act.id, paired, othersKey(acts.map((a) => ({ entityId: a.qlooEntityId })), act.qlooEntityId), now());
          result.paired++;
        } else {
          result.notes.push(`Pairings for ${act.name} could not be fetched; the previous ones are kept.`);
        }
      }
    } catch (err) {
      if (!(err instanceof BudgetExceededError)) throw err;
      result.budget = err;
      result.skipped = units.length - i;
      break;
    }
  }
  result.calls = source.used();
  return result;
}

/** Affinity of every other act among this act's fans, or null when a call failed. */
async function pairActs(act: ActRow, acts: readonly ActRow[], source: QlooSource, opts: { runId: string; scope: QlooScope; fresh: boolean }) {
  const others = acts.filter((a) => a.qlooEntityId !== act.qlooEntityId);
  const byCategory = new Map<ActRow["type"], ActRow[]>();
  for (const a of others) byCategory.set(a.type, [...(byCategory.get(a.type) ?? []), a]);
  const out: Record<string, number | null> = {};
  for (const [category, group] of byCategory) {
    const ids = group.map((a) => a.qlooEntityId);
    try {
      const res = await source.affinitiesOf([act.qlooEntityId], ids, category, opts);
      const found = new Map(res.data.map((c) => [c.id, c.affinity]));
      // Asked and not returned is recorded as null: Qloo has no affinity for it.
      for (const id of ids) out[id] = found.get(id) ?? null;
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      console.warn("[roster] pairing failed:", describeFailure(err));
      return null;
    }
  }
  return out;
}

export function qlooReady(source: QlooSource): boolean {
  return source.mock || Boolean(process.env.QLOO_API_KEY?.trim() && process.env.QLOO_BASE_URL?.trim());
}

export type RefreshOutcome =
  | { status: "fresh" }
  | { status: "blocked"; message: string; estimate: RefreshEstimate }
  | { status: "done"; estimate: RefreshEstimate; calls: number; note: string }
  | { status: "queued"; estimate: RefreshEstimate; batches: number };

/**
 * Starts a refresh after checking its estimate against what the workspace has left. One batch
 * runs now; more are staggered through the job queue, one job per batch.
 */
export async function startRefresh(repo: WorkspaceRepo, rosterId: string, input: { force: boolean; now?: Date }): Promise<RefreshOutcome> {
  if (!can(repo.context.role, "roster.edit")) throw new ForbiddenError("roster.edit");
  const source = getQlooSource();
  if (!qlooReady(source)) throw new InputError("Qloo data is unavailable right now.");
  const loaded = await load(repo, rosterId, source.mock);
  if (!loaded) throw new InputError("That roster isn't in this workspace.");
  const now = input.now ?? new Date();
  const plan = planRefresh(loaded.planActs, { now, force: input.force });
  if (!plan.units.length) return { status: "fresh" };

  const usage = await workspaceUsage(repo.context.workspaceId);
  const block = refreshBlock(plan.estimate, usage);
  if (block) return { status: "blocked", message: block.message, estimate: plan.estimate };

  const refreshId = crypto.randomUUID();
  if (plan.batches.length === 1) {
    const jobId = await repo.jobs.create({ kind: "roster.refresh", targetId: rosterId, status: "running", payload: { refreshId, batch: 1, of: 1 } });
    await repo.jobs.update(jobId, { startedAt: new Date() });
    const result = await runBatch(repo, rosterId, plan.batches[0], { source, scope: { kind: "workspace", workspaceId: repo.context.workspaceId }, fresh: input.force });
    const note = batchNote(result);
    await repo.jobs.update(jobId, { status: result.budget ? "skipped_budget" : "done", qlooCalls: result.calls, note, finishedAt: new Date() });
    return { status: "done", estimate: plan.estimate, calls: result.calls, note };
  }

  if (queueMode() === "off") {
    return {
      status: "blocked",
      message: `This roster needs ${plan.batches.length} batches, which run in the background, and background jobs are not set up here. Remove some acts or refresh fewer at a time.`,
      estimate: plan.estimate,
    };
  }
  const stagger = staggerSeconds();
  for (const [i, units] of plan.batches.entries()) {
    const jobId = await repo.jobs.create({ kind: "roster.refresh", targetId: rosterId, status: "queued", payload: { refreshId, batch: i + 1, of: plan.batches.length, units } });
    try {
      await enqueue({ kind: "roster.refresh", jobId, workspaceId: repo.context.workspaceId, userId: repo.context.userId, rosterId, units, force: input.force }, i * stagger);
    } catch (err) {
      console.error("[roster] enqueue failed:", err instanceof Error ? err.name : "unknown");
      await repo.jobs.update(jobId, { status: "failed", note: "Could not be queued.", finishedAt: new Date() });
    }
  }
  return { status: "queued", estimate: plan.estimate, batches: plan.batches.length };
}

/** What a batch did, in plain words, for the roster page and the job log. */
export function batchNote(r: BatchResult): string {
  const parts = [`Scored ${r.profiled} act${r.profiled === 1 ? "" : "s"}, paired ${r.paired}, ${r.calls} Qloo call${r.calls === 1 ? "" : "s"}.`];
  if (r.budget) parts.push(`Skipped: ${budgetLimitText(r.budget.limitName)} was reached, so ${r.skipped} act${r.skipped === 1 ? " was" : "s were"} not refreshed. Nothing retries until the limit resets.`);
  return [...parts, ...r.notes].join(" ");
}

/** Everything the roster page shows. Pair scores come from scoreRosterPairs only. */
export async function rosterView(repo: WorkspaceRepo, rosterId: string, input: { now?: Date } = {}): Promise<RosterView | null> {
  const mock = isMockMode();
  const loaded = await load(repo, rosterId, mock);
  if (!loaded) return null;
  const { roster, acts, profiles, planActs } = loaded;
  const now = input.now ?? new Date();

  const views: RosterActView[] = acts.map((a, i) => {
    const p = profiles.get(a.qlooEntityId);
    return {
      id: a.id,
      entityId: a.qlooEntityId,
      name: a.name,
      category: a.type,
      kind: actKind(a),
      homeCity: a.homeCity,
      profile: p?.profile ?? null,
      profileAt: p?.at.toISOString() ?? null,
      stale: profileStale(planActs[i], now) || pairingsStale(planActs[i], planActs, now),
    };
  });

  const signals: RosterActSignal[] = acts.map((a) => {
    const profile: ActProfile | undefined = profiles.get(a.qlooEntityId)?.profile;
    return {
      id: a.qlooEntityId,
      name: a.name,
      category: a.type,
      affinities: a.affinities ?? {},
      market: profile?.market,
      heat: profile ? new Map(Object.entries(profile.heat).map(([id, [mean, cells]]) => [id, { mean, cells }])) : undefined,
    };
  });
  const { pairs, unscored } = scoreRosterPairs(signals, metroPool());
  const asked = (x: RosterActSignal, y: RosterActSignal) => y.id in x.affinities;
  const byId = new Map(signals.map((s) => [s.id, s]));
  const pending = unscored.filter((u) => !asked(byId.get(u.a.id)!, byId.get(u.b.id)!) && !asked(byId.get(u.b.id)!, byId.get(u.a.id)!));

  const usage = await workspaceUsage(repo.context.workspaceId);
  const jobs = await repo.jobs.listFor(rosterId, 20);
  const latest = (jobs[0]?.payload as { refreshId?: string } | null)?.refreshId;
  const jobViews: RosterJobView[] = jobs
    .filter((j) => latest && (j.payload as { refreshId?: string } | null)?.refreshId === latest)
    .map((j) => ({ id: j.id, status: j.status, note: j.note, qlooCalls: j.qlooCalls, createdAt: j.createdAt.toISOString(), finishedAt: j.finishedAt?.toISOString() ?? null }));

  return {
    id: roster.id,
    name: roster.name,
    acts: views,
    pairs,
    unscored: unscored.filter((u) => !pending.includes(u)),
    pendingPairs: pending.length,
    estimate: { stale: planRefresh(planActs, { now }).estimate, all: planRefresh(planActs, { now, force: true }).estimate },
    usage: { used: usage.used, allowance: usage.allowance, remaining: usage.remaining, dailyRemaining: usage.dailyRemaining },
    jobs: jobViews,
    canEdit: can(repo.context.role, "roster.edit"),
    mock,
  };
}
