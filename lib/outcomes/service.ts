import "server-only";

import type { WorkspaceRepo } from "@/lib/db/scoped";
import { InputError } from "@/lib/db/scoped";
import { ENGINE_CONFIG } from "@/lib/engine/config";
import { outcomeReport, sellThrough, type OutcomeReport, type Prediction } from "@/lib/engine/outcomes";

import type { ReportView } from "@/lib/export/outcomes";

import { predictionsFromPlan } from "./predict";

export interface OutcomeFields {
  attendance: number | null;
  ticketsSold: number | null;
  capacity: number | null;
  gross: number | null;
  sponsorRenewed: boolean | null;
  notes: string | null;
}

const MAX_COUNT = 10_000_000;

/** Every field optional; numbers are whole and non-negative (gross may have cents). */
export function parseOutcome(body: Record<string, unknown>): OutcomeFields {
  const count = (k: string) => {
    const v = body[k];
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[\s,]/g, ""));
    if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) throw new InputError(`${k === "ticketsSold" ? "Tickets sold" : k[0].toUpperCase() + k.slice(1)} must be a whole number of 0 or more.`);
    return n;
  };
  const g = body.gross;
  let gross: number | null = null;
  if (g !== null && g !== undefined && g !== "") {
    gross = typeof g === "number" ? g : Number(String(g).replace(/[\s,$€£]/g, ""));
    if (!Number.isFinite(gross) || gross < 0 || gross > 1e12) throw new InputError("Gross must be a number of 0 or more.");
  }
  const r = body.sponsorRenewed;
  const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 2000) || null : null;
  return { attendance: count("attendance"), ticketsSold: count("ticketsSold"), capacity: count("capacity"), gross, sponsorRenewed: r === true ? true : r === false ? false : null, notes };
}

/**
 * The plan's frozen predictions. A plan saved before Outcomes existed has none; its predictions are
 * then read from the plan as it was stored when it was made (never recomputed) and frozen now.
 */
async function frozen(repo: WorkspaceRepo, planId: string): Promise<{ predicted: Prediction; at: Date; backfilled: boolean } | null> {
  const row = await repo.outcomes.prediction(planId);
  if (row) return { predicted: row.predicted, at: row.createdAt, backfilled: false };
  const plan = await repo.plans.get(planId);
  if (!plan) return null;
  return { predicted: predictionsFromPlan(plan.result), at: plan.createdAt, backfilled: true };
}

async function events(repo: WorkspaceRepo) {
  const rows = await repo.outcomes.logged();
  return rows.map((r) => ({
    planId: r.planId,
    input: r.input,
    outcome: r.outcome,
    prediction: r.predicted ?? null,
    sellThrough: sellThrough(r.outcome.ticketsSold, r.outcome.capacity),
  }));
}

/** The workspace's own minimum sample (Settings), else the engine default. */
export async function workspaceReport(repo: WorkspaceRepo, minSampleOverride?: number) {
  const minSample = minSampleOverride ?? (await repo.workspace.get())?.outcomeMinSample ?? ENGINE_CONFIG.outcomes.minSample;
  const rows = await events(repo);
  const report = outcomeReport(
    rows.filter((r) => r.prediction).map((r) => ({ planId: r.planId, prediction: r.prediction!, sellThrough: r.sellThrough })),
    minSample,
  );
  return { report, rows };
}

export type ResultLine = { metric: string; predicted: string; actual: string; result: string; tone: "good" | "bad" | "neutral" };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const n = (x: number) => x.toLocaleString("en-GB");

/** Sell-through against the workspace's own median, or why it cannot be judged. */
export function versusMedian(st: number | null, report: OutcomeReport): Pick<ResultLine, "result" | "tone"> {
  if (st === null) return { result: "Needs tickets sold and capacity", tone: "neutral" };
  if (!report.judged || report.median === null) return { result: `Too few events to judge (${report.sample} of ${report.minSample})`, tone: "neutral" };
  if (st > report.median) return { result: `Above your median (${pct(report.median)}, ${report.sample} events)`, tone: "good" };
  return { result: `Not above your median (${pct(report.median)}, ${report.sample} events)`, tone: "bad" };
}

/** One plan: what it predicted (frozen), what was logged, and how it compares. */
export async function planOutcome(repo: WorkspaceRepo, planId: string) {
  const plan = await repo.plans.get(planId);
  if (!plan) return null;
  const [pred, outcome, { report }, ws] = await Promise.all([frozen(repo, planId), repo.outcomes.get(planId), workspaceReport(repo), repo.workspace.get()]);
  const p = pred?.predicted ?? null;
  const st = outcome ? sellThrough(outcome.ticketsSold, outcome.capacity) : null;
  const vs = versusMedian(st, report);
  const actualSell = st !== null && outcome ? `${pct(st)} sell-through (${n(outcome.ticketsSold!)} of ${n(outcome.capacity!)})` : "—";
  const lines: ResultLine[] = outcome
    ? [
        {
          metric: "City",
          predicted: p?.city ? `${p.city.name}, #${p.city.rank} of ${p.city.of} · ${Math.round(p.city.combined * 100)} / 100 · ${p.city.confidence}` : "—",
          actual: actualSell,
          ...vs,
        },
        {
          metric: "Partner",
          predicted: p?.partner ? `${p.partner.name}, #${p.partner.rank} · score ${p.partner.score.toFixed(2)} · ${p.partner.confidence}` : "—",
          actual: actualSell,
          ...vs,
        },
        {
          metric: "Venue",
          predicted: p?.venue ? `${p.venue.name} · ${p.venue.confidence}` : "—",
          actual: outcome.capacity !== null ? `${n(outcome.capacity)} sellable capacity` : "—",
          result: outcome.attendance !== null && outcome.capacity !== null ? `${n(outcome.attendance)} attended` : "—",
          tone: "neutral",
        },
        {
          metric: "Top sponsor",
          predicted: p?.sponsors[0] ? `${p.sponsors[0].name}, #${p.sponsors[0].rank}` : "—",
          actual: outcome.sponsorRenewed === null ? "—" : outcome.sponsorRenewed ? "Renewed" : "Not renewed",
          result: outcome.sponsorRenewed === null ? "—" : outcome.sponsorRenewed ? "Renewed" : "Not renewed",
          tone: outcome.sponsorRenewed === null ? "neutral" : outcome.sponsorRenewed ? "good" : "bad",
        },
      ]
    : [];
  return {
    plan: { id: plan.id, input: plan.input, title: plan.result.brief?.title ?? plan.input, city: p?.city?.name ?? null, venue: p?.venue?.name ?? null, createdAt: plan.createdAt.toISOString() },
    prediction: p,
    predictedAt: pred?.at.toISOString() ?? null,
    backfilled: pred?.backfilled ?? false,
    outcome: outcome
      ? { attendance: outcome.attendance, ticketsSold: outcome.ticketsSold, capacity: outcome.capacity, gross: outcome.gross, sponsorRenewed: outcome.sponsorRenewed, notes: outcome.notes, loggedAt: outcome.loggedAt.toISOString() }
      : null,
    sellThrough: st,
    lines,
    /** The workspace's currency for gross (Settings), or null when not set. */
    currency: ws?.currency ?? null,
    report: { median: report.median, sample: report.sample, minSample: report.minSample, judged: report.judged },
  };
}

export type PlanOutcome = NonNullable<Awaited<ReturnType<typeof planOutcome>>>;

/** Logs results, freezing the plan's predictions first if they were not yet (a plan from before Outcomes). */
export async function logOutcome(repo: WorkspaceRepo, planId: string, fields: OutcomeFields) {
  const p = await frozen(repo, planId);
  if (!p) throw new InputError("That plan isn't in this workspace.");
  if (p.backfilled) await repo.outcomes.freeze(planId, p.predicted, p.at);
  await repo.outcomes.save(planId, fields);
}

/** The report for the page and its exports. */
export async function reportView(repo: WorkspaceRepo, workspace: string): Promise<ReportView> {
  const [{ report, rows }, ws] = await Promise.all([workspaceReport(repo), repo.workspace.get()]);
  return {
    workspace,
    currency: ws?.currency ?? null,
    rows: rows.map((r) => ({
      plan: r.input,
      city: r.prediction?.city?.name ?? null,
      partner: r.prediction?.partner?.name ?? null,
      predictedCity: r.prediction?.city?.combined ?? null,
      predictedPartner: r.prediction?.partner?.score ?? null,
      attendance: r.outcome.attendance,
      ticketsSold: r.outcome.ticketsSold,
      capacity: r.outcome.capacity,
      sellThrough: r.sellThrough,
      gross: r.outcome.gross,
      sponsorRenewed: r.outcome.sponsorRenewed,
      aboveMedian: r.sellThrough === null || report.median === null ? null : r.sellThrough > report.median,
    })),
    sample: report.sample,
    median: report.median,
    minSample: report.minSample,
    judged: report.judged,
    aboveMedian: report.aboveMedian,
    cities: report.cities,
    partners: report.partners,
  };
}
