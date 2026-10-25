import "server-only";

import type Anthropic from "@anthropic-ai/sdk";

import { scoreCities } from "@/lib/engine/cities";
import { ENGINE_CONFIG, FORMAT_LABEL } from "@/lib/engine/config";
import { formatFor } from "@/lib/engine/formats";
import { DEFAULT_MARKET, marketFor } from "@/lib/engine/markets";
import { CITIES } from "@/lib/engine/data";
import { CATEGORY_LABEL, explain } from "@/lib/engine/explain";
import { classifyMatches, foldName, isComedian } from "@/lib/engine/match";
import { metroCities, nearestCities } from "@/lib/engine/metro";
import { scorePartners } from "@/lib/engine/partners";
import { rankBrands, rankPlaces } from "@/lib/engine/places";
import { planTour } from "@/lib/engine/tour";
import type { Category, City, Entity, Pick } from "@/lib/engine/types";
import type { QlooCallOptions } from "@/lib/qloo/client";
import type { QlooSource, SourceMeta } from "@/lib/qloo/source";

import { safeProse, sanitizeProse, type Slots } from "./sanitize";
import { BRIEF_TEMPLATES, OUTREACH_TEMPLATES } from "./script";
import type { RunState } from "./state";
import {
  TO_CONFIRM,
  type Brief,
  type BriefItem,
  type RoomResult,
  type Choice,
  type Explained,
  type StepId,
  type StepStatus,
} from "./types";

export interface ToolContext {
  state: RunState;
  source: QlooSource;
  opts: QlooCallOptions;
}

export interface ToolOutcome {
  status: Exclude<StepStatus, "running">;
  summary: string;
  data?: unknown;
  calls: SourceMeta[];
  branch?: boolean;
  /** On a fallback: what happened, separate from the decision in `summary`. */
  fallbackNote?: string;
  /** What the model sees instead of `data`, when `data` is large. */
  forModel?: unknown;
}

export interface ToolDef {
  name: string;
  step: StepId;
  description: string;
  input_schema: Anthropic.Beta.BetaTool.InputSchema;
  /** Shown on the step card while the tool runs. */
  running(state: RunState): string;
  /** Null when the tool can run; otherwise what must happen first. */
  requires(state: RunState): string | null;
  run(input: Record<string, unknown>, ctx: ToolContext): Promise<ToolOutcome>;
}

/** Categories a crossover partner can come from, in the order tried first. */
export const PARTNER_CATEGORIES: readonly Category[] = [
  "artist",
  "podcast",
  "tv_show",
  "movie",
  "person",
  "brand",
  "videogame",
];
const FIRST_PASS = 4;

const TO_CONFIRM_ITEMS: Array<{ item: string; value: typeof TO_CONFIRM }> = [
  "Capacity",
  "Dates",
  "Ticket prices",
  "Availability",
].map((item) => ({ item, value: TO_CONFIRM }));

let metro: City[] | undefined;
/** GeoNames cities folded into metros, computed once per process. */
function metroPool(): City[] {
  metro ??= metroCities(CITIES);
  return metro;
}

/** "Chicago, Illinois": Qloo resolves names; the region separates same-named cities. */
export function cityQuery(city: City): string {
  const region = city.admin1 && city.admin1 !== city.name ? city.admin1 : "";
  return [city.name, region].filter(Boolean).join(", ");
}

function cityReason(basis: "both" | "fanbase", thin: boolean, fanbase: string, partner: string, market: string): string {
  if (basis === "fanbase") return `${partner} has no city-level data in ${market}, so cities are ranked by ${fanbase} fans alone.`;
  return thin ? "City-level heat is thin for at least one audience." : "Both audiences have city-level heat.";
}

/** Runs `fn` over `items` with at most `limit` in flight; results keep input order. */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

const explained = <P extends Pick>(pick: P): Explained<P> => ({ pick, explanation: explain(pick) });
const label = (c: Category) => CATEGORY_LABEL[c];
const withArticle = (c: Category) => `${/^[aeiou]/i.test(label(c)) ? "an" : "a"} ${label(c)}`;
const two = (n: number) => n.toFixed(2);
const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

const resolveFanbase: ToolDef = {
  name: "resolve_fanbase",
  step: "identify",
  description:
    "Search Qloo for the fanbase the user typed and decide whether it is one clear match, " +
    "several matches, a likely misspelling, or nothing. Always call this first.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  running: (s) => `Searching Qloo for “${s.query}”…`,
  requires: () => null,
  async run(_input, { state, source, opts }) {
    const res = await source.searchEntities(state.query, undefined, opts);
    const calls = [res.meta];

    const chosenId = state.overrides.entityId;
    if (chosenId) {
      const chosen = res.data.find((e) => e.id === chosenId);
      if (chosen) {
        state.fanbase = chosen;
        return {
          status: "done",
          summary: `Using your pick: ${chosen.name} (${label(chosen.category)}).`,
          data: { fanbase: chosen },
          calls,
        };
      }
      state.notes.push("The match you picked was not in the results again, so I matched the name afresh.");
    }

    const match = classifyMatches(state.query, res.data);
    state.match = match;
    if (match.kind === "resolved") {
      state.fanbase = match.entity;
      return {
        status: "done",
        summary: `Matched “${state.query}” to ${match.entity.name} (${label(match.entity.category)}).`,
        data: { fanbase: match.entity },
        calls,
      };
    }

    if (match.kind === "none") {
      state.needsInput = {
        kind: "none",
        question: `We couldn't find a fanbase called “${state.query}”.`,
        choices: [],
      };
      state.stopped = true;
      return { status: "needs_input", summary: state.needsInput.question, data: state.needsInput, calls, branch: true };
    }

    const choices: Choice[] = match.options.map(({ entity }) => toChoice(entity));
    const question =
      match.kind === "ambiguous"
        ? `Found ${choices.length} matches for “${state.query}”, which one?`
        : `No fanbase called “${state.query}”, did you mean ${choices.map((c) => c.name).join(" or ")}?`;
    state.needsInput = { kind: match.kind, question, choices };
    return {
      status: "done",
      summary: question,
      data: state.needsInput,
      calls,
      branch: true,
      forModel: { kind: match.kind, choices, next: "Call ask_user." },
    };
  },
};

function toChoice(entity: Entity): Choice {
  return {
    entityId: entity.id,
    name: entity.name,
    category: entity.category,
    imageUrl: entity.imageUrl,
    // Qloo's own description, else its disambiguation line (a year, a birth date).
    detail: shorten(entity.description ?? entity.disambiguation ?? label(entity.category), 110),
  };
}

const askUser: ToolDef = {
  name: "ask_user",
  step: "identify",
  description:
    "Pause the run and show the user the matches from resolve_fanbase. Use when it reports " +
    "several matches or a likely misspelling. The choices come from resolve_fanbase; you only " +
    "write the question.",
  input_schema: {
    type: "object",
    properties: { question: { type: "string", description: "One short question for the user." } },
    additionalProperties: false,
  },
  running: () => "Waiting for your pick…",
  requires: (s) => (s.needsInput && !s.fanbase ? null : "resolve_fanbase must report several matches first"),
  async run(input, { state }) {
    const needs = state.needsInput!;
    const asked = sanitizeProse(input.question).text;
    if (asked && !asked.includes(TO_CONFIRM)) needs.question = asked;
    state.stopped = true;
    return { status: "needs_input", summary: needs.question, data: needs, calls: [], branch: true };
  },
};

const chooseFormat: ToolDef = {
  name: "choose_format",
  step: "format",
  description: "Pick the event format for the fanbase's type (rule in code).",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
  running: () => "Choosing the format…",
  requires: (s) => (s.fanbase ? null : "resolve_fanbase first"),
  async run(_input, { state }) {
    const fanbase = state.fanbase!;
    const rule = formatFor(fanbase);
    state.format = { ...rule, label: FORMAT_LABEL[rule.format] };
    const what =
      fanbase.category === "person"
        ? isComedian(fanbase)
          ? "a comedian"
          : "a performer"
        : withArticle(fanbase.category);
    return {
      status: "done",
      summary: `${state.format.label}, since ${fanbase.name} is ${what}.`,
      data: state.format,
      calls: [],
    };
  },
};

const findPartners: ToolDef = {
  name: "find_partners",
  step: "partners",
  description:
    "Find crossover partners from other categories whose fans overlap with the fanbase, scored " +
    "by code. Optionally name the categories to try; set widen=true to try every category " +
    "(use once, when the result suggests widening).",
  input_schema: {
    type: "object",
    properties: {
      categories: {
        type: "array",
        items: { type: "string", enum: [...PARTNER_CATEGORIES] },
        description: "Categories to try. Defaults to four likely ones.",
      },
      widen: { type: "boolean", description: "Try every category." },
    },
    additionalProperties: false,
  },
  running: (s) => (s.partners ? "Widening the partner search…" : "Looking for crossover partners…"),
  requires: (s) => (s.fanbase ? null : "resolve_fanbase first"),
  async run(input, { state, source, opts }) {
    const fanbase = state.fanbase!;
    const pool = PARTNER_CATEGORIES.filter((c) => c !== fanbase.category);
    const asked = Array.isArray(input.categories)
      ? pool.filter((c) => (input.categories as unknown[]).includes(c))
      : [];
    const widen = input.widen === true;
    if (widen) state.partnersWidened = true;
    const wanted = widen ? pool : asked.length ? asked : pool.slice(0, FIRST_PASS);

    const calls: SourceMeta[] = [];
    // Three at a time: faster than one by one, well under Qloo's 10 calls a second.
    const todo = wanted.filter((c) => !state.candidates.has(c));
    const fetched = await mapLimit(todo, 3, (category) => source.candidates([fanbase.id], category, undefined, opts));
    todo.forEach((category, i) => {
      calls.push(fetched[i].meta);
      state.candidates.set(category, fetched[i].data);
    });

    // Exclude the fanbase and its own twin records (Qloo lists people as both person and artist).
    const twins = [...state.candidates.values()].flat().filter((c) => foldName(c.name) === foldName(fanbase.name));
    const result = scorePartners([...state.candidates.values()].flat(), {
      excludeIds: [fanbase.id, ...twins.map((t) => t.id)],
    });
    const wantedPartner = state.overrides.partnerId;
    const chosen =
      result.picks.find((p) => p.entity.id === wantedPartner) ?? result.picks[0] ?? null;
    if (wantedPartner && chosen?.entity.id !== wantedPartner) {
      state.notes.push("The partner you picked is no longer shortlisted, so I used the top pick.");
    }
    const untried = pool.filter((c) => !state.candidates.has(c));
    state.partner = chosen?.entity ?? null;
    state.partners = {
      picks: result.picks.map(explained),
      chosenId: chosen?.entity.id ?? null,
      fallback: result.fallback,
      reason: result.reason,
      categoriesTried: [...state.candidates.keys()],
      droppedCount: result.dropped.length,
    };

    const forModel = {
      picks: state.partners.picks.map((p) => ({
        id: p.pick.entity.id,
        name: p.pick.entity.name,
        category: p.pick.entity.category,
        confidence: p.pick.confidence,
      })),
      fallback: result.fallback,
      reason: result.reason,
      untried,
    };

    if (result.fallback && untried.length > 0 && !state.partnersWidened) {
      return {
        status: "fallback",
        summary: "No partner above the threshold, so I'm widening to more categories.",
        data: state.partners,
        calls,
        branch: true,
        forModel: { ...forModel, next: "Call find_partners with widen=true." },
      };
    }
    if (!chosen) {
      return {
        status: "fallback",
        summary: "No crossover partner found.",
        fallbackNote: result.reason,
        data: state.partners,
        calls,
        forModel,
      };
    }
    const e = chosen.entity;
    const summary =
      `Picked ${e.name} (${label(e.category)}): affinity ${two(e.affinity)}, popularity ` +
      `${two(e.popularity)}, score ${two(chosen.score)}.`;
    return {
      status: result.fallback ? "fallback" : "done",
      summary,
      fallbackNote: result.fallback ? result.reason : undefined,
      data: state.partners,
      calls,
      forModel,
    };
  },
};

const pickCity: ToolDef = {
  name: "pick_city",
  step: "city",
  description:
    "Rank cities where both the fanbase and the partner's fans are strong, inside one market " +
    "(country), from Qloo heatmaps scored by code. The market defaults to the fanbase's home " +
    "country; pass country (ISO code) to choose another. If city-level data is thin, call again " +
    'once with level="region".',
  input_schema: {
    type: "object",
    properties: {
      country: { type: "string", description: "ISO 3166-1 alpha-2 code, e.g. GB." },
      level: { type: "string", enum: ["city", "region"] },
    },
    additionalProperties: false,
  },
  running: (s) => (s.city ? "Widening to regional overlap…" : "Comparing where both audiences are strongest…"),
  requires: (s) => (!s.partner ? "find_partners must pick a partner first" : !s.format ? "choose_format first" : null),
  async run(input, { state, source, opts }) {
    const fanbase = state.fanbase!;
    const partner = state.partner!;
    const format = state.format!;
    const calls: SourceMeta[] = [];

    // Qloo heatmaps need a location, so cities are ranked inside one market (decisions D7).
    const market =
      marketFor(str(input.country)) ?? marketFor(fanbase.homeCountry) ?? marketFor(DEFAULT_MARKET)!;
    if (state.heat?.partnerId !== partner.id || state.heat.market !== market.code) {
      const [a, b] = await Promise.all([
        source.heatmap([fanbase.id], market.name, opts),
        source.heatmap([partner.id], market.name, opts),
      ]);
      calls.push(a.meta, b.meta);
      state.heat = { partnerId: partner.id, market: market.code, a: a.data, b: b.data };
    }

    const level = input.level === "region" ? "region" : "city";
    if (level === "region") state.cityWidened = true;
    const pool = metroPool().filter((c) => c.country === market.code);

    const cfg = ENGINE_CONFIG.cities;
    const radiusKm = level === "region" ? cfg.regionalRadiusKm : cfg.radiusKm;
    const score = (cities: readonly City[]) =>
      scoreCities(state.heat!.a, state.heat!.b, cities, format.minPopulation, { radiusKm });
    // Second pass over cities where both audiences show up, so population rank compares like
    // with like instead of against every large city on Earth.
    const overlap = score(pool).filter((s) => s.combined > 0).map((s) => s.city);
    let scores = overlap.length ? score(overlap) : score(pool);
    // Fallback: the partner has no city-level heat in this market, so rank by the fanbase alone.
    let basis: "both" | "fanbase" = "both";
    if (!scores[0] || scores[0].combined === 0) {
      const alone = (cities: readonly City[]) =>
        scoreCities(state.heat!.a, state.heat!.a, cities, format.minPopulation, { radiusKm });
      const heated = alone(pool).filter((s) => s.combined > 0).map((s) => s.city);
      const fanbaseOnly = heated.length ? alone(heated) : [];
      if (fanbaseOnly[0]?.combined) {
        scores = fanbaseOnly;
        basis = "fanbase";
      }
    }
    const top = scores[0];
    const thin =
      !top || top.combined === 0 || Math.min(top.evidence.cellsA, top.evidence.cellsB) < cfg.minCellsForHigh;
    const wantedCity = state.overrides.cityId;
    const chosen =
      scores.find((s) => s.city.id === wantedCity && s.combined > 0) ??
      (top && top.combined > 0 ? top : null);
    if (wantedCity && chosen?.city.id !== wantedCity) {
      state.notes.push("The city you picked has no overlap data, so I used the top city.");
    }

    state.chosenCity = chosen?.city ?? null;
    state.city = {
      table: scores.slice(0, cfg.tableSize).map(explained),
      chosen: chosen ? explained(chosen) : null,
      populationPick: scores.find((s) => s.populationRank === 1) ?? null,
      tour: planTour(scores, { anchorId: chosen?.city.id }),
      map: scores.slice(0, 10).map((s) => ({
        id: s.city.id,
        name: s.city.name,
        lat: s.city.lat,
        lon: s.city.lon,
        combined: s.combined,
      })),
      level,
      market,
      basis,
      fallback: thin || basis === "fanbase",
      reason: cityReason(basis, thin, fanbase.name, partner.name, market.name),
    };

    const forModel = {
      top: state.city.table.map((t) => ({ id: t.pick.city.id, name: t.pick.city.name, country: t.pick.city.country })),
      chosenId: chosen?.city.id ?? null,
      thin,
      level,
    };
    if (thin && level === "city" && !state.cityWidened) {
      return {
        status: "fallback",
        summary: "Not enough city-level data, so I'm widening to regional overlap.",
        data: state.city,
        calls,
        branch: true,
        forModel: { ...forModel, next: 'Call pick_city with level="region".' },
      };
    }
    if (!chosen) {
      return {
        status: "fallback",
        summary: "No city picked.",
        fallbackNote: "No city has heat for both audiences.",
        data: state.city,
        calls,
        forModel,
      };
    }
    const c = chosen;
    if (basis === "fanbase") {
      return {
        status: "fallback",
        summary: `Picked ${c.city.name}: ${fanbase.name} fans are strongest here (${two(c.sA)}); #${c.populationRank} by population.`,
        fallbackNote: state.city.reason,
        data: state.city,
        calls,
        branch: true,
        forModel,
      };
    }
    const summary =
      `Picked ${c.city.name}: combined ${two(c.combined)} (${two(c.sA)} for ${fanbase.name}, ` +
      `${two(c.sB)} for ${partner.name}); #${c.populationRank} by population.`;
    return {
      status: thin ? "fallback" : "done",
      summary,
      fallbackNote: thin ? "City-level data was thin, so this is based on regional overlap." : undefined,
      data: state.city,
      calls,
      forModel,
    };
  },
};

const planRoom: ToolDef = {
  name: "plan_room",
  step: "room",
  description:
    "Find the venue, a local opener or host, after-show spots and sponsor brands in the chosen " +
    "city (Qloo places and brands, ranked by code). If no tagged venue exists there, the nearest " +
    "city is used unless allowNearestCity is false.",
  input_schema: {
    type: "object",
    properties: {
      cityId: { type: "string", description: "A city id from pick_city; defaults to the chosen city." },
      allowNearestCity: { type: "boolean" },
    },
    additionalProperties: false,
  },
  running: (s) => `Finding the room and sponsors in ${s.chosenCity?.name ?? "the city"}…`,
  requires: (s) => (s.chosenCity ? null : "pick_city must choose a city first"),
  async run(input, { state, source, opts }) {
    const format = state.format!;
    const ids = [state.fanbase!.id, state.partner!.id];
    const asked = str(input.cityId);
    let city = (asked && metroPool().find((c) => c.id === asked)) || state.chosenCity!;
    const calls: SourceMeta[] = [];

    const venuesIn = async (c: City) => {
      const res = await source.places(ids, cityQuery(c), format.venueTags, opts);
      calls.push(res.meta);
      return rankPlaces(res.data, format.venueTags, undefined, format.avoidTags);
    };

    let venues = await venuesIn(city);
    let movedFrom: { cityName: string; distanceKm: number } | null = null;
    if (venues.fallback && input.allowNearestCity !== false) {
      const eligible = metroPool().filter((c) => c.population >= format.minPopulation);
      const [near] = nearestCities(city, eligible, 1);
      if (near) {
        const there = await venuesIn(near.city);
        if (!there.fallback) {
          movedFrom = { cityName: city.name, distanceKm: Math.round(near.distanceKm) };
          city = near.city;
          venues = there;
        }
      }
    }

    const where = cityQuery(city);
    const venue = venues.picks[0] ?? null;
    const spotsRes = await source.places(ids, where, format.spotTags, opts);
    const brandsRes = await source.brands(ids, where, opts);
    // Musicians get artists as openers; everyone else gets people (comedians, hosts).
    const openerCategory: Category = state.fanbase!.category === "artist" ? "artist" : "person";
    const openerRes = await source.candidates(ids, openerCategory, where, opts);
    calls.push(spotsRes.meta, brandsRes.meta, openerRes.meta);

    const spots = rankPlaces(
      spotsRes.data.filter((p) => p.id !== venue?.place.id),
      format.spotTags,
      ENGINE_CONFIG.places.spots,
    );
    const sponsors = rankBrands(brandsRes.data);
    const opener = scorePartners(openerRes.data, { count: 1, minCategories: 1, excludeIds: ids });

    const fallback = venues.fallback || spots.fallback || sponsors.fallback;
    const reasons = [venues, spots, sponsors].filter((r) => r.fallback).map((r) => r.reason);
    const result: RoomResult = {
      cityName: city.name,
      movedFrom,
      venue: venue ? explained(venue) : null,
      opener: opener.picks[0] ? explained(opener.picks[0]) : null,
      spots: spots.picks.map(explained),
      sponsors: sponsors.picks.map(explained),
      toConfirm: TO_CONFIRM_ITEMS,
      fallback,
      reason: reasons.join(" ") || "Venue, spots and sponsors all found.",
    };
    state.room = result;

    const summary = venue
      ? `Picked ${venue.place.name} with ${count(spots.picks.length, "spot")} and ${count(sponsors.picks.length, "sponsor")}.`
      : "No venue found; spots and sponsors listed where available.";
    const notes = movedFrom
      ? [`No tagged venues in ${movedFrom.cityName}, so I used ${city.name}, ${movedFrom.distanceKm} km away.`]
      : [];
    if (fallback) notes.push(result.reason);
    return {
      status: fallback || movedFrom ? "fallback" : "done",
      summary,
      fallbackNote: notes.length ? notes.join(" ") : undefined,
      data: result,
      calls,
      branch: Boolean(movedFrom),
      forModel: {
        city: city.name,
        venue: venue?.place.name ?? null,
        opener: result.opener?.pick.entity.name ?? null,
        spots: result.spots.map((s) => s.pick.place.name),
        sponsors: result.sponsors.map((s) => s.pick.brand.name),
        fallback,
      },
    };
  },
};

const PROSE_RULE =
  "Prose only. Use the placeholders {fanbase}, {partner}, {city}, {venue}, {format} and " +
  "{sponsors} instead of names. No numbers, dates, prices, capacity or availability.";

const writeBrief: ToolDef = {
  name: "write_brief",
  step: "brief",
  description: `Write the one-page brief. The app fills names, scores and sources from engine data. ${PROSE_RULE}`,
  input_schema: {
    type: "object",
    properties: {
      headline: { type: "string", description: "One sentence pitching the event." },
      partnerReason: { type: "string", description: "Why this partner, one or two sentences." },
      cityReason: { type: "string" },
      venueReason: { type: "string" },
      sponsorReason: { type: "string" },
    },
    additionalProperties: false,
  },
  running: () => "Writing the brief…",
  requires: (s) => (s.room ? null : "plan_room first"),
  async run(input, { state }) {
    const slots = slotsFor(state);
    let replaced = 0;
    let templated = true;
    const prose = (key: keyof typeof BRIEF_TEMPLATES) => {
      if (str(input[key])) templated = false;
      const out = safeProse(input[key], slots, BRIEF_TEMPLATES[key]);
      replaced += out.replaced;
      return out.text;
    };

    const room = state.room!;
    const partner = state.partners!.picks.find((p) => p.pick.entity.id === state.partner!.id)!;
    const city = state.city!.chosen!;
    const items: BriefItem[] = [
      {
        label: "Partner",
        name: partner.pick.entity.name,
        reason: prose("partnerReason"),
        evidence: partner.explanation,
        source: `Qloo /v2/insights, filter.type=urn:entity:${partner.pick.entity.category}`,
        confidence: partner.pick.confidence,
      },
      {
        label: "City",
        name: `${city.pick.city.name}, ${city.pick.city.country}`,
        reason: prose("cityReason"),
        evidence: city.explanation,
        source: "Qloo /v2/insights, filter.type=urn:heatmap; cities from GeoNames",
        confidence: city.pick.confidence,
      },
    ];
    if (room.venue) {
      items.push({
        label: "Venue",
        name: room.venue.pick.place.name,
        reason: prose("venueReason"),
        evidence: room.venue.explanation,
        source: "Qloo /v2/insights, filter.type=urn:entity:place",
        confidence: room.venue.pick.confidence,
      });
    }
    if (room.opener) {
      items.push({
        label: "Opener or host",
        name: room.opener.pick.entity.name,
        reason: "",
        evidence: room.opener.explanation,
        source: `Qloo /v2/insights, filter.type=urn:entity:${room.opener.pick.entity.category}, signal.location`,
        confidence: room.opener.pick.confidence,
      });
    }
    if (room.sponsors.length) {
      items.push({
        label: "Sponsors",
        name: room.sponsors.map((s) => s.pick.brand.name).join(", "),
        reason: prose("sponsorReason"),
        evidence: room.sponsors.map((s) => s.explanation).join(" "),
        source: "Qloo /v2/insights, filter.type=urn:entity:brand",
        confidence: room.sponsors[0].pick.confidence,
      });
    }

    const brief: Brief = {
      title: `${state.format!.label}: ${slots.fanbase} × ${slots.partner} in ${room.cityName}`,
      headline: prose("headline"),
      format: state.format!.label,
      items,
      toConfirm: TO_CONFIRM_ITEMS,
      templated,
    };
    state.brief = brief;
    if (replaced) state.notes.push(`Replaced ${replaced} unconfirmed detail(s) in the brief with “${TO_CONFIRM}”.`);
    return {
      status: "done",
      summary: templated ? "Brief written from the template." : "Brief written.",
      data: brief,
      calls: [],
      forModel: { title: brief.title, replacedUnconfirmedDetails: replaced },
    };
  },
};

const draftOutreach: ToolDef = {
  name: "draft_outreach",
  step: "outreach",
  description: `Draft two emails: to the partner's team and to the venue. Drafts only; nothing is sent. ${PROSE_RULE}`,
  input_schema: {
    type: "object",
    properties: {
      partnerSubject: { type: "string" },
      partnerBody: { type: "string" },
      venueSubject: { type: "string" },
      venueBody: { type: "string" },
    },
    additionalProperties: false,
  },
  running: () => "Drafting outreach…",
  requires: (s) => (s.brief ? null : "write_brief first"),
  async run(input, { state }) {
    const slots = slotsFor(state);
    let replaced = 0;
    const prose = (key: keyof typeof OUTREACH_TEMPLATES) => {
      const out = safeProse(input[key], slots, OUTREACH_TEMPLATES[key]);
      replaced += out.replaced;
      return out.text;
    };
    state.outreach = [
      {
        to: "partner",
        recipient: `${slots.partner}'s team`,
        subject: prose("partnerSubject"),
        body: prose("partnerBody"),
      },
      {
        to: "venue",
        recipient: state.room!.venue ? `${slots.venue} bookings` : "Venue bookings",
        subject: prose("venueSubject"),
        body: prose("venueBody"),
      },
    ];
    if (replaced) state.notes.push(`Replaced ${replaced} unconfirmed detail(s) in the emails with “${TO_CONFIRM}”.`);
    return {
      status: "done",
      summary: "Two drafts ready. Takeover never sends email.",
      data: state.outreach,
      calls: [],
      forModel: { drafted: 2, replacedUnconfirmedDetails: replaced },
    };
  },
};

function slotsFor(state: RunState): Slots {
  const room = state.room;
  return {
    fanbase: state.fanbase?.name ?? "the fanbase",
    partner: state.partner?.name ?? "the partner",
    city: room?.cityName ?? state.chosenCity?.name ?? "the city",
    venue: room?.venue?.pick.place.name ?? "the venue",
    format: (state.format?.label ?? "event").toLowerCase(),
    sponsors: room?.sponsors.map((s) => s.pick.brand.name).join(", ") || "local brands",
  };
}

export const TOOLS: readonly ToolDef[] = [
  resolveFanbase,
  askUser,
  chooseFormat,
  findPartners,
  pickCity,
  planRoom,
  writeBrief,
  draftOutreach,
];

export const TOOLS_BY_NAME: ReadonlyMap<string, ToolDef> = new Map(TOOLS.map((t) => [t.name, t]));

/** Tool definitions for the Messages API. */
export function anthropicTools(): Anthropic.Beta.BetaTool[] {
  return TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}
