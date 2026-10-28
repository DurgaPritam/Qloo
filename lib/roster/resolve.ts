import "server-only";

import { withBudget } from "@/lib/agent/budget";
import type { Entity } from "@/lib/engine/types";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import type { QlooScope } from "@/lib/qloo/allowance";
import { QLOO_RUN_BUDGET } from "@/lib/qloo/client";
import { BudgetExceededError, budgetLimitText } from "@/lib/qloo/errors";
import type { QlooSource } from "@/lib/qloo/source";
import { describeFailure, resolveEntity, type CallView, type Choice } from "@/lib/tools/shared";

import type { CsvAct } from "./csv";
import type { RosterEntity } from "./types";

export const toRosterEntity = (e: Entity): RosterEntity => ({
  id: e.id,
  name: e.name,
  category: e.category,
  popularity: e.popularity,
  description: e.description,
  disambiguation: e.disambiguation,
  homeCountry: e.homeCountry,
  tags: e.tags?.slice(0, 20),
});

export type FindResult =
  | { status: "resolved"; entity: RosterEntity }
  | { status: "choose"; question: string; choices: Choice[] }
  | { status: "none" };

/** The add-an-act search: the same resolver and picker as a plan's first step. One Qloo search. */
export async function findAct(query: string, entityId: string | undefined, source: QlooSource, scope: QlooScope): Promise<FindResult> {
  const runId = `roster-add-${crypto.randomUUID()}`;
  const calls: CallView[] = [];
  const r = await resolveEntity(query, FANBASE_CATEGORIES, entityId, withBudget(source, runId, 2), { runId, scope }, calls);
  if (r.kind === "resolved") return { status: "resolved", entity: toRosterEntity(r.entity) };
  if (r.kind === "choose") return { status: "choose", question: r.question, choices: r.choices };
  return { status: "none" };
}

export interface Unresolved {
  row: number;
  name: string;
  homeCity?: string;
  /** Empty when Qloo found nothing close; the user can search again by another name. */
  choices: Choice[];
  reason: string;
}

/**
 * Resolves imported names, one search each, in runs of the per-run budget. A name that resolves
 * goes on the roster; an ambiguous or unknown one comes back for matching by hand. Once a budget
 * is reached the rest come back unresolved with that reason, and nothing else is searched.
 */
export async function resolveImport(rows: readonly CsvAct[], source: QlooSource, scope: QlooScope) {
  const resolved: { row: number; entity: RosterEntity; homeCity?: string }[] = [];
  const unresolved: Unresolved[] = [];
  let stop: string | null = null;
  for (let start = 0; start < rows.length; start += QLOO_RUN_BUDGET) {
    const runId = `roster-import-${crypto.randomUUID()}`;
    const budgeted = withBudget(source, runId, QLOO_RUN_BUDGET);
    for (const row of rows.slice(start, start + QLOO_RUN_BUDGET)) {
      if (stop) {
        unresolved.push({ row: row.row, name: row.name, homeCity: row.homeCity, choices: [], reason: stop });
        continue;
      }
      try {
        const r = await resolveEntity(row.name, FANBASE_CATEGORIES, row.qlooId, budgeted, { runId, scope }, []);
        if (r.kind === "resolved") resolved.push({ row: row.row, entity: toRosterEntity(r.entity), homeCity: row.homeCity });
        else if (r.kind === "choose") unresolved.push({ row: row.row, name: row.name, homeCity: row.homeCity, choices: r.choices, reason: r.question });
        else unresolved.push({ row: row.row, name: row.name, homeCity: row.homeCity, choices: [], reason: `Qloo has no entity matching “${row.name}”.` });
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          stop = `Not searched: ${budgetLimitText(err.limitName)} was reached.`;
          unresolved.push({ row: row.row, name: row.name, homeCity: row.homeCity, choices: [], reason: stop });
        } else {
          console.warn("[roster] import search failed:", describeFailure(err));
          unresolved.push({ row: row.row, name: row.name, homeCity: row.homeCity, choices: [], reason: "Qloo search did not answer; try this one again." });
        }
      }
    }
  }
  return { resolved, unresolved };
}
