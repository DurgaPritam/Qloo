import "server-only";

import { withBudget } from "@/lib/agent/budget";
import type { Plan } from "@/lib/agent/types";
import { scoreCities } from "@/lib/engine/cities";
import { formatFor } from "@/lib/engine/formats";
import { DEFAULT_MARKET, marketFor } from "@/lib/engine/markets";
import type { Category, Entity } from "@/lib/engine/types";
import type { WorkspaceRepo } from "@/lib/db/scoped";
import { InputError } from "@/lib/db/scoped";
import { MAX_OUTPUT_TOKENS } from "@/lib/llm";
import type { LLMProvider } from "@/lib/llm/types";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import { BudgetExceededError } from "@/lib/qloo/errors";
import type { QlooSource } from "@/lib/qloo/source";
import { audienceProfiles } from "@/lib/tools/audience";
import { describeFailure, metroPool, resolveEntity, view, type CallView, type Choice } from "@/lib/tools/shared";
import { can, ForbiddenError } from "@/lib/workspace/permissions";

import { buildBrief, checkAngles, label, type BriefCity, type CampaignBriefData, type InterestGroup } from "./brief";

/** Categories asked for interests, one insights call each. */
export const INTEREST_CATEGORIES: Category[] = ["artist", "tv_show", "movie", "podcast", "brand"];
/** Search (fanbase alone) + demographics + one per category + heatmap (fanbase alone). */
export const BRIEF_CALLS = 2 + INTEREST_CATEGORIES.length + 1;
const PER_CATEGORY = 4;
const WEEK_MS = 8 * 24 * 60 * 60 * 1000;

export type BriefRequest = { planId: string } | { query: string; entityId?: string };
export type BriefResult = { status: "done"; id: string; brief: CampaignBriefData } | { status: "choose"; question: string; choices: Choice[] } | { status: "none" };

/**
 * Makes and saves a targeting brief from a plan or a fanbase alone. Qloo: demographics, one
 * insights call per category, and (fanbase alone) a search and a heatmap for its cities; a plan's
 * cities are the plan's own. The model writes the three angles from the brief's numbered facts and
 * must cite them; checkAngles replaces any it gets wrong with a labelled template.
 */
export async function makeBrief(
  repo: WorkspaceRepo,
  input: BriefRequest & { title?: string | null; flight?: string | null },
  deps: { source: QlooSource; model: LLMProvider | null; now: Date },
): Promise<BriefResult> {
  if (!can(repo.context.role, "plan.create")) throw new ForbiddenError("plan.create");
  const runId = `brief-${crypto.randomUUID()}`;
  const source = withBudget(deps.source, runId, BRIEF_CALLS);
  const opts = { runId, scope: { kind: "workspace" as const, workspaceId: repo.context.workspaceId } };
  const calls: CallView[] = [];

  let fanbase: Entity;
  let plan: Plan | null = null;
  if ("planId" in input) {
    plan = (await repo.plans.get(input.planId))?.result ?? null;
    if (!plan?.fanbase) throw new InputError("That plan isn't in this workspace, or has no fanbase.");
    fanbase = plan.fanbase;
  } else {
    const r = await resolveEntity(input.query, FANBASE_CATEGORIES, input.entityId, source, opts, calls);
    if (r.kind === "none") return { status: "none" };
    if (r.kind === "choose") return { status: "choose", question: r.question, choices: r.choices };
    fanbase = r.entity;
  }
  const partner = plan?.partners?.picks.find((p) => p.pick.entity.id === plan!.partners?.chosenId)?.pick.entity ?? null;

  const [profiles, interests, cities] = await Promise.all([
    audienceProfiles([fanbase.id], source, opts, calls),
    interestGroups(fanbase, source, opts, calls),
    plan ? Promise.resolve(planCities(plan)) : fanbaseCities(fanbase, source, opts, calls),
  ]);
  // A Market watch alert from the last week about one of the cities becomes its note.
  if (can(repo.context.role, "watch.read")) {
    const ids = new Map(cities.map((c) => [c.id, c]));
    for (const a of await repo.watch.alerts({ since: new Date(deps.now.getTime() - WEEK_MS), limit: 100 })) {
      const c = ids.get(a.entityId);
      if (c && !c.note) c.note = `This week: ${a.title}`;
    }
  }

  const p = profiles[0]?.summary;
  const brief = buildBrief({
    source: plan ? { kind: "plan", planId: (input as { planId: string }).planId } : { kind: "fanbase" },
    fanbase: { id: fanbase.id, name: fanbase.name, category: fanbase.category },
    partner: partner?.name ?? null,
    city: plan?.room?.cityName ?? cities[0]?.name ?? null,
    title: input.title,
    flight: input.flight,
    audience: p ? { of: fanbase.name, skewsTo: p.skewsTo, gender: p.gender, genderSkew: p.genderSkew, bands: p.bands } : null,
    interests,
    cities: cities.map((c) => ({ name: c.name, score: c.score, rank: c.rank, populationRank: c.populationRank, note: c.note })),
    mock: deps.source.mock,
    now: deps.now,
  });
  brief.sources = calls.map((c) => ({ figure: figureOf(c), endpoint: c.endpoint, params: c.params }));
  if (deps.model) brief.angles = await modelAngles(deps.model, brief);
  const id = await repo.briefs.save(plan ? (input as { planId: string }).planId : null, brief);
  return { status: "done", id, brief };
}

function figureOf(c: CallView): string {
  const t = c.params["filter.type"] ?? "";
  if (t === "urn:demographics") return "Audience";
  if (t === "urn:heatmap") return "Cities";
  if (t.startsWith("urn:entity:")) return `Interests: ${t.slice("urn:entity:".length)}`;
  return "Search";
}

async function interestGroups(fanbase: Entity, source: QlooSource, opts: { runId: string }, calls: CallView[]): Promise<InterestGroup[]> {
  const groups = await Promise.all(
    INTEREST_CATEGORIES.map(async (category): Promise<InterestGroup | null> => {
      try {
        const res = await source.candidates([fanbase.id], category, undefined, opts);
        calls.push(view(res.meta));
        const items = res.data
          .filter((e) => e.id !== fanbase.id && e.name !== fanbase.name && Number.isFinite(e.affinity))
          .sort((a, b) => b.affinity - a.affinity || a.name.localeCompare(b.name))
          .slice(0, PER_CATEGORY)
          .map((e) => ({ id: e.id, name: e.name, affinity: e.affinity, tags: e.tags ?? [] }));
        return items.length ? { category, label: label(category), items } : null;
      } catch (err) {
        if (err instanceof BudgetExceededError) throw err;
        console.warn("[campaign] interests failed:", describeFailure(err));
        return null;
      }
    }),
  );
  return groups.filter((g): g is InterestGroup => g !== null);
}

type CityRow = BriefCity & { id: string };

function planCities(plan: Plan): CityRow[] {
  return (plan.city?.table ?? []).slice(0, 5).map((t) => ({ id: t.pick.city.id, name: t.pick.city.name, score: Math.round(t.pick.combined * 100), rank: t.pick.rank, populationRank: t.pick.populationRank, note: null }));
}

async function fanbaseCities(fanbase: Entity, source: QlooSource, opts: { runId: string }, calls: CallView[]): Promise<CityRow[]> {
  const market = marketFor(fanbase.homeCountry) ?? marketFor(DEFAULT_MARKET)!;
  try {
    const res = await source.heatmap([fanbase.id], market.name, opts);
    calls.push(view(res.meta));
    const pool = metroPool().filter((c) => c.country === market.code);
    return scoreCities(res.data, res.data, pool, formatFor(fanbase).minPopulation)
      .filter((c) => c.combined > 0)
      .slice(0, 5)
      .map((c) => ({ id: c.city.id, name: c.city.name, score: Math.round(c.combined * 100), rank: c.rank, populationRank: c.populationRank, note: null }));
  } catch (err) {
    if (err instanceof BudgetExceededError) throw err;
    console.warn("[campaign] heatmap failed:", describeFailure(err));
    return [];
  }
}

async function modelAngles(model: LLMProvider, brief: CampaignBriefData) {
  const prompt = [
    "You write three creative angles for an event or music marketing campaign, using only the facts below.",
    "Reply with JSON only: an array of 3 objects, each {\"title\": string, \"body\": one sentence, \"facts\": [fact ids]}.",
    "Each angle must cite at least one fact id and mention that fact's name exactly as written.",
    "Use no numbers at all, and never mention reach, impressions, CPM, budget, prices, dates or capacity.",
    "",
    ...brief.facts.map((f) => `${f.id}: ${f.text}`),
  ].join("\n");
  try {
    const res = await model.complete(prompt, { maxOutputTokens: Math.min(800, MAX_OUTPUT_TOKENS.completion) });
    if (res.refused) return brief.angles;
    const json = res.text.slice(res.text.indexOf("["), res.text.lastIndexOf("]") + 1);
    return checkAngles(JSON.parse(json), brief.facts, brief.angles);
  } catch {
    return brief.angles;
  }
}
