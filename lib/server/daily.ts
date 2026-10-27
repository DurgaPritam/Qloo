import "server-only";

import { createHash } from "node:crypto";

import type { Plan } from "@/lib/agent/types";
import { CATEGORY_LABEL } from "@/lib/engine/explain";
import type { Category } from "@/lib/engine/types";
import { SHOWCASE } from "@/lib/examples";

import { loadRecording } from "./replay";

/** Puzzle #1 is this UTC day. */
const LAUNCH = Date.UTC(2026, 9, 27);
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DailyOption {
  id: string;
  label: string;
  meta: string;
}

export interface DailyRound {
  question: string;
  options: DailyOption[];
}

/** Sent to the browser: no answers. */
export interface DailyPuzzle {
  number: number;
  date: string;
  fanbase: string;
  rounds: DailyRound[];
}

interface Answers {
  correct: string[];
  /** What Qloo said about each option, shown after the guess. */
  reveal: Array<Record<string, string>>;
  query: string;
}

const two = (x: number) => x.toFixed(2);
const kind = (c: Category) => CATEGORY_LABEL[c].charAt(0).toUpperCase() + CATEGORY_LABEL[c].slice(1);
const pct = (x: number) => Math.round(x * 100);

function seeded(seed: string) {
  let n = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 8), 16);
  return () => {
    n = (n * 1103515245 + 12345) % 2 ** 31;
    return n / 2 ** 31;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Today's date (UTC) and puzzle number. */
export function today(now = Date.now()): { date: string; number: number } {
  const date = new Date(now).toISOString().slice(0, 10);
  return { date, number: Math.floor((Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) - LAUNCH) / DAY_MS) + 1 };
}

const cache = new Map<string, { puzzle: DailyPuzzle; answers: Answers } | null>();

/**
 * Builds the day's puzzle from a preloaded plan (no Qloo or model calls): which partner, which
 * city, which sponsor. Decoys come from the plan itself (the shortlist, the biggest city by
 * population) and from other preloaded plans; every reveal is the plan's own Qloo numbers.
 */
export async function dailyPuzzle(date: string, number: number): Promise<{ puzzle: DailyPuzzle; answers: Answers } | null> {
  if (cache.has(date)) return cache.get(date)!;
  const recordings = (await Promise.all(SHOWCASE.map((q) => loadRecording(q)))).filter((r) => r?.plan.status === "complete");
  if (recordings.length < 4) return null;
  const rand = seeded(`takeover-daily:${date}`);
  const plans = recordings.map((r) => r!.plan);
  // The day's order of plans; the first that fills all three rounds is today's puzzle.
  let built: ReturnType<typeof build> | null = null;
  for (const plan of shuffle(plans, rand)) {
    const attempt = build(plan, plans.filter((p) => p.runId !== plan.runId), seeded(`takeover-daily:${date}:${plan.runId}`), date, number);
    if (!built || attempt.puzzle.rounds.length > built.puzzle.rounds.length) built = attempt;
    if (attempt.puzzle.rounds.length === 3) break;
  }
  cache.set(date, built);
  if (cache.size > 10) cache.delete(cache.keys().next().value!);
  return built;
}

function build(plan: Plan, others: Plan[], rand: () => number, date: string, number: number) {
  const fanbase = plan.fanbase!.name;
  const partner = plan.partners!.picks.find((p) => p.pick.entity.id === plan.partners!.chosenId)!.pick;
  const correct: string[] = [];
  const reveal: Answers["reveal"] = [];
  const rounds: DailyRound[] = [];

  // Round 1: the partner. The shortlist, plus another plan's partner from outside it.
  const shortlist = plan.partners!.picks.map((p) => p.pick);
  const decoy = shuffle(others, rand)
    .map((o) => o.partners?.picks.find((p) => p.pick.entity.id === o.partners?.chosenId)?.pick.entity)
    .find((e) => e && !shortlist.some((s) => s.entity.id === e.id));
  const r1 = new Map<string, string>();
  const o1: DailyOption[] = shortlist.map((p) => {
    r1.set(p.entity.id, `Score ${pct(p.score)} / 100 · affinity ${two(p.entity.affinity)}`);
    return { id: p.entity.id, label: p.entity.name, meta: kind(p.entity.category) };
  });
  if (decoy) {
    r1.set(decoy.id, `Not on ${fanbase}'s shortlist; it's another fanbase's partner.`);
    o1.push({ id: decoy.id, label: decoy.name, meta: kind(decoy.category) });
  }
  rounds.push({ question: `Which crossover partner do ${fanbase} fans over-index on most?`, options: shuffle(o1, rand) });
  correct.push(partner.entity.id);
  reveal.push(Object.fromEntries(r1));

  // Round 2: the city. Qloo's top cities and the biggest city by population; when the table is
  // short (thin markets), the plan's map list fills in. Skipped with fewer than three options.
  const table = plan.city!.table.map((t) => t.pick);
  const r2 = new Map<string, string>();
  const o2: DailyOption[] = [];
  const add = (id: string, label: string, meta: string, reveal: string) => {
    if (o2.length >= 4 || r2.has(id)) return;
    r2.set(id, reveal);
    o2.push({ id, label, meta });
  };
  const cityReveal = (c: (typeof table)[number]) => `Qloo #${c.rank} · combined ${pct(c.combined)} / 100 · #${c.populationRank} by population`;
  for (const c of table.slice(0, 3)) add(c.city.id, c.city.name, c.city.admin1 || c.city.country, cityReveal(c));
  const pop = plan.city!.populationPick;
  if (pop) add(pop.city.id, pop.city.name, pop.city.admin1 || pop.city.country, cityReveal(pop));
  plan.city!.map.forEach((m, i) => add(m.id, m.name, plan.city!.market.name, `Qloo #${i + 1} · combined ${pct(m.combined)} / 100`));
  if (o2.length >= 3) {
    rounds.push({ question: `Where are ${fanbase} and ${partner.entity.name} fans strongest together?`, options: shuffle(o2, rand) });
    correct.push(plan.city!.chosen!.pick.city.id);
    reveal.push(Object.fromEntries(r2));
  }

  // Round 3: the sponsor. Qloo's top brand for the pair, plus other plans' sponsors.
  const sponsors = plan.room?.sponsors.map((s) => s.pick.brand) ?? [];
  if (sponsors.length) {
    const theirs = new Set(sponsors.map((s) => s.id));
    const decoys = shuffle(
      others.flatMap((o) => o.room?.sponsors.map((s) => s.pick.brand) ?? []).filter((b) => !theirs.has(b.id)),
      rand,
    ).filter((b, i, all) => all.findIndex((x) => x.id === b.id) === i);
    const opts = [sponsors[0], ...decoys.slice(0, 3)];
    const r3 = new Map(opts.map((b) => [b.id, b.id === sponsors[0].id ? `Qloo's top sponsor for this pair (affinity ${two(b.affinity)})` : "A sponsor for a different takeover."]));
    rounds.push({
      question: `Which brand do both audiences over-index on, as a sponsor in ${plan.room!.cityName}?`,
      options: shuffle(opts.map((b) => ({ id: b.id, label: b.name, meta: "Brand" })), rand),
    });
    correct.push(sponsors[0].id);
    reveal.push(Object.fromEntries(r3));
  }

  return { puzzle: { number, date, fanbase, rounds }, answers: { correct, reveal, query: plan.query } };
}
