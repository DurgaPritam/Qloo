import "server-only";

import type { WorkspaceRepo } from "@/lib/db/scoped";
import { InputError } from "@/lib/db/scoped";
import { CATEGORY_LABEL } from "@/lib/engine/explain";
import { isComedian } from "@/lib/engine/match";
import type { SponsorFit } from "@/lib/engine/sponsor";
import type { Category, Entity } from "@/lib/engine/types";
import type { PitchInput, PitchSource } from "@/lib/export/sponsor";
import type { QlooScope } from "@/lib/qloo/allowance";
import { QLOO_RUN_BUDGET } from "@/lib/qloo/client";
import type { QlooSource } from "@/lib/qloo/source";
import { findAct } from "@/lib/roster/resolve";
import { withBudget } from "@/lib/agent/budget";
import { kvGet, kvSet } from "@/lib/server/kv";
import { matchBrand } from "@/lib/tools/brand";
import type { CallView, Choice } from "@/lib/tools/shared";
import { brandsToPitch, type RightsHolder } from "@/lib/tools/sponsor";
import { THIS_WEEK_DAYS, thisWeekLines, type WatchContext, type WatchLine } from "./this-week";
import { can, ForbiddenError } from "@/lib/workspace/permissions";

/**
 * Sponsorship runs. Results are kept server-side for a day as a draft; the shortlist saves a match
 * by its draft and key, so a saved fit is always the engine's, never a number sent by the browser.
 */
export interface MatchView {
  key: string;
  /** "Talent", "Podcast", "Team"… for the brand view; the brand's sector for the rights view. */
  kind: string;
  name: string;
  meta: string;
  fit: SponsorFit;
  pitch: PitchInput;
  /** From the workspace's Market watch, when it watches the holder, the brand or a city. */
  thisWeek: WatchLine[];
}

export type SponsorRun =
  | { status: "choose"; question: string; choices: Choice[] }
  | { status: "none" }
  | {
      status: "done";
      view: "brand" | "rights";
      draftId: string;
      subject: { name: string; meta: string };
      /** Brand view: one list. Rights view: grouped by sector. */
      groups: { label: string; matches: MatchView[] }[];
      notes: string[];
      calls: number;
      mock: boolean;
    };

interface Draft {
  workspaceId: string;
  view: "brand" | "rights";
  holderKeys: Record<string, string>;
  brandIds: Record<string, string>;
  matches: Record<string, PitchInput>;
}

const DRAFT_TTL = 24 * 60 * 60;
const draftKey = (id: string) => `takeover:sponsor:draft:v1:${id}`;
const scope = (repo: WorkspaceRepo): QlooScope => ({ kind: "workspace", workspaceId: repo.context.workspaceId });

const KIND: Partial<Record<Category, string>> = { artist: "Music artist", person: "Talent", podcast: "Podcast", tv_show: "TV show", brand: "Team", movie: "Film" };
const kindOf = (category: Category, list?: string) => (list === "Teams" ? "Team" : (KIND[category] ?? CATEGORY_LABEL[category]));

function audienceOf(name: string, a: { summary: { skewsTo: string[]; gender: "female" | "male" | "balanced" } } | null | undefined): PitchInput["audience"] {
  return a ? { of: name, skewsTo: a.summary.skewsTo, gender: a.summary.gender } : null;
}

function describeEntity(e: Pick<Entity, "category" | "description" | "tags" | "name" | "popularity">): string {
  if (e.category === "person" && isComedian(e as Entity)) return "Comedian";
  return kindOf(e.category);
}

/** One source per figure that has a recorded request. */
function sources(entries: [string, CallView | undefined][]): PitchSource[] {
  return entries.flatMap(([figure, c]) => (c ? [{ figure, endpoint: c.endpoint, params: c.params }] : []));
}

/** The workspace's recent alerts and its watched cities' latest snapshots; no Qloo call. */
async function watchContext(repo: WorkspaceRepo, now: Date): Promise<WatchContext> {
  if (!can(repo.context.role, "watch.read")) return { alerts: [], cities: [] };
  const since = new Date(now.getTime() - THIS_WEEK_DAYS * 86_400_000);
  const [alerts, items] = await Promise.all([repo.watch.alerts({ since, limit: 200 }), repo.watch.items()]);
  const recent = items.filter((i) => i.kind === "city" && i.lastSnapshotAt && i.lastSnapshotAt >= since);
  const cities = await Promise.all(
    recent.map(async (i) => {
      const [snap] = await repo.watch.snapshots(i.id, 1);
      return snap ? [{ name: i.name, takenAt: snap.takenAt, lists: snap.summary.lists }] : [];
    }),
  );
  return { alerts, cities: cities.flat() };
}

async function saveDraft(draft: Draft) {
  const id = crypto.randomUUID();
  await kvSet(draftKey(id), draft, DRAFT_TTL);
  return id;
}

/** Brand view: talent, shows, podcasts and teams for a brand, each with its fit both ways. */
export async function runBrandView(repo: WorkspaceRepo, input: { query: string; entityId?: string }, source: QlooSource): Promise<SponsorRun> {
  if (!can(repo.context.role, "sponsor.edit")) throw new ForbiddenError("sponsor.edit");
  const runId = `sponsor-${crypto.randomUUID()}`;
  const budgeted = withBudget(source, runId, QLOO_RUN_BUDGET);
  const r = await matchBrand(input.query, input.entityId, budgeted, { runId, scope: scope(repo) }, { teams: true, audience: true, reverse: 6 });
  if (r.status !== "done") return r.status === "choose" ? { status: "choose", question: r.question ?? "Which brand?", choices: r.choices ?? [] } : { status: "none" };

  const cities = r.cities.slice(0, 5).map((c) => ({ name: c.city.name, score: c.combined }));
  const audience = audienceOf(r.brand.name, r.audience);
  const now = new Date();
  const watched = await watchContext(repo, now);
  const matches: MatchView[] = (r.fits ?? []).map((f) => ({
    key: f.id,
    thisWeek: thisWeekLines(watched, { ids: [f.id] }, { id: r.brand.id, name: r.brand.name }, now),
    kind: kindOf(f.category, f.list),
    name: f.name,
    meta: `${f.list} ${r.brand.name} fans over-index on`,
    fit: f.fit,
    pitch: {
      holder: f.name,
      brand: r.brand.name,
      fit: f.fit,
      audience,
      cities,
      sources: sources([
        [`${r.brand.name} among ${f.name} fans (fit, forward)`, f.forwardCall],
        [`${f.name} among ${r.brand.name} fans (fit, backward)`, f.listCall],
        [`Cities: ${r.brand.name} fans' heat`, r.heatCall],
        [`Audience: ${r.brand.name} fans`, r.audienceCall],
      ]),
      mock: source.mock,
    },
  }));
  const draftId = await saveDraft({
    workspaceId: repo.context.workspaceId,
    view: "brand",
    holderKeys: Object.fromEntries(matches.map((m) => [m.key, m.key])),
    brandIds: Object.fromEntries(matches.map((m) => [m.key, r.brand.id])),
    matches: Object.fromEntries(matches.map((m) => [m.key, m.pitch])),
  });
  const skew = audience && audience.skewsTo.length ? ` · fans most often ${audience.skewsTo.slice(0, 2).join(" or ")}` : "";
  return {
    status: "done",
    view: "brand",
    draftId,
    subject: { name: r.brand.name, meta: `${r.brand.description ?? "Brand"}${skew}${cities[0] ? ` · strongest in ${cities[0].name}` : ""}. Talent and teams that fit:` },
    groups: [{ label: "Matches", matches }],
    notes: matches.length ? [] : ["No talent, show or team had Qloo affinity with this brand both ways."],
    calls: budgeted.used(),
    mock: source.mock,
  };
}

export type HolderInput = { kind: "entity"; query: string; entityId?: string } | { kind: "event"; planId: string } | { kind: "roster"; rosterId: string };

/** Rights-holder view: brands to pitch for an act or team, a saved plan (event) or a roster. */
export async function runRightsView(repo: WorkspaceRepo, input: HolderInput, source: QlooSource): Promise<SponsorRun> {
  if (!can(repo.context.role, "sponsor.edit")) throw new ForbiddenError("sponsor.edit");
  const runId = `sponsor-${crypto.randomUUID()}`;
  const budgeted = withBudget(source, runId, QLOO_RUN_BUDGET);
  const opts = { runId, scope: scope(repo) };

  let holder: RightsHolder;
  let meta: string;
  if (input.kind === "entity") {
    const found = await findAct(input.query, input.entityId, budgeted, scope(repo));
    if (found.status === "none") return { status: "none" };
    if (found.status === "choose") return { status: "choose", question: found.question, choices: found.choices };
    holder = { kind: "entity", entity: { ...found.entity, popularity: found.entity.popularity ?? 0 } };
    meta = describeEntity({ ...found.entity, popularity: found.entity.popularity ?? 0 });
  } else if (input.kind === "event") {
    const row = await repo.plans.get(input.planId);
    const plan = row?.result;
    const partner = plan?.partners?.picks.find((p) => p.pick.entity.id === plan.partners?.chosenId)?.pick.entity;
    if (!plan?.fanbase || !partner) throw new InputError("Pick a finished plan with a partner.");
    holder = { kind: "event", name: `${plan.fanbase.name} × ${partner.name}`, ids: [plan.fanbase.id, partner.id], cities: plan.city?.table.map((t) => t.pick) ?? [] };
    meta = `Event · ${plan.room?.cityName ?? plan.city?.chosen?.pick.city.name ?? "city to choose"}`;
  } else {
    const roster = await repo.rosters.get(input.rosterId);
    const acts = roster ? await repo.rosters.acts(roster.id) : [];
    if (!roster || !acts.length) throw new InputError("Pick a roster with acts on it.");
    holder = { kind: "roster", name: roster.name, ids: acts.slice(0, 10).map((a) => a.qlooEntityId) };
    meta = `Roster · ${acts.length} act${acts.length === 1 ? "" : "s"}${acts.length > 10 ? " (the first 10 as one audience)" : ""}`;
  }

  const r = await brandsToPitch(holder, budgeted, opts);
  const holderKey = [...r.holder.ids].sort((a, b) => a.localeCompare(b)).join(",");
  const cities = r.cities.map((c) => ({ name: c.city.name, score: c.combined }));
  const audience = audienceOf(r.holder.name, r.audience);
  const now = new Date();
  const watched = await watchContext(repo, now);
  const groups = r.groups.map((g) => ({
    label: g.sector,
    matches: g.brands.map(
      (b): MatchView => ({
        key: b.id,
        thisWeek: thisWeekLines(watched, { ids: r.holder.ids }, { id: b.id, name: b.name }, now),
        kind: g.sector === "Other" ? "Brand" : g.sector,
        name: b.name,
        meta: b.description ?? "Brand",
        fit: b.fit,
        pitch: {
          holder: r.holder.name,
          brand: b.name,
          sector: g.sector,
          fit: b.fit,
          audience,
          cities,
          sources: sources([
            [`${b.name} among ${r.holder.name} fans (fit, forward)`, r.sourceCalls.brands],
            [`${r.holder.name} among ${b.name} fans (fit, backward)`, b.backwardCall],
            [`Cities: ${r.holder.name} fans' heat`, r.sourceCalls.heat],
            [`Audience: ${r.holder.name} fans`, r.sourceCalls.audience],
          ]),
          mock: source.mock,
        },
      }),
    ),
  }));
  const all = groups.flatMap((g) => g.matches);
  const draftId = await saveDraft({
    workspaceId: repo.context.workspaceId,
    view: "rights",
    holderKeys: Object.fromEntries(all.map((m) => [m.key, holderKey])),
    brandIds: Object.fromEntries(all.map((m) => [m.key, m.key])),
    matches: Object.fromEntries(all.map((m) => [m.key, m.pitch])),
  });
  return {
    status: "done",
    view: "rights",
    draftId,
    subject: { name: r.holder.name, meta: `${meta}${cities[0] ? ` · strongest in ${cities[0].name}` : ""}. Brands to pitch:` },
    groups,
    notes: r.notes,
    calls: budgeted.used(),
    mock: source.mock,
  };
}

/** Saves one match of a run to the shortlist, from the server's copy of the run. */
export async function shortlistMatch(repo: WorkspaceRepo, draftId: string, key: string) {
  const draft = /^[0-9a-f-]{36}$/.test(draftId) ? await kvGet<Draft>(draftKey(draftId)) : null;
  if (!draft || draft.workspaceId !== repo.context.workspaceId) throw new InputError("These results have expired. Run the search again.");
  const pitch = draft.matches[key];
  if (!pitch) throw new InputError("That match is not in these results.");
  return repo.sponsorship.save({ view: draft.view, holderKey: draft.holderKeys[key], brandId: draft.brandIds[key], pitch });
}
