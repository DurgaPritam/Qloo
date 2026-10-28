import type { AudienceSummary } from "@/lib/engine/audience";
import { CATEGORY_LABEL } from "@/lib/engine/explain";
import type { Category } from "@/lib/engine/types";
import type { SlideOutline } from "@/lib/export/outline";

/**
 * A one-page targeting brief for a fanbase (from a plan, or the fanbase alone): Qloo's audience
 * skews, what the fans over-index on by category, the engine's strongest cities, interest keywords
 * grouped for ad platforms, and three creative angles. Every number is Qloo's or the engine's; there
 * is no reach, impressions, CPM or budget figure anywhere. The model writes the angles from a list
 * of facts and must cite them; anything that adds a number is replaced by a template, labelled.
 */
export interface BriefInterest {
  id: string;
  name: string;
  /** 0–1, Qloo affinity among the fanbase's fans. */
  affinity: number;
  tags: string[];
}

export interface InterestGroup {
  category: Category;
  label: string;
  items: BriefInterest[];
}

export interface BriefCity {
  name: string;
  /** 0–100, the engine's city score. */
  score: number;
  rank: number;
  populationRank: number;
  note: string | null;
}

export interface KeywordGroup {
  group: string;
  keywords: string[];
}

export interface BriefFact {
  id: string;
  text: string;
  /** The name an angle citing this fact must mention. */
  name: string;
}

export interface BriefAngle {
  title: string;
  body: string;
  facts: string[];
  /** "model": written by the model from the facts; "template": the model was unavailable or its answer was refused. */
  by: "model" | "template";
}

export interface CampaignBriefData {
  title: string;
  source: { kind: "plan"; planId: string } | { kind: "fanbase" };
  fanbase: { id: string; name: string; category: Category };
  partner: string | null;
  city: string | null;
  /** The user's own campaign window; null → "to confirm". */
  flight: string | null;
  audience: (Pick<AudienceSummary, "skewsTo" | "gender" | "genderSkew" | "bands"> & { of: string }) | null;
  /** Shown when Qloo had no demographics, so the gap is labelled rather than hidden. */
  audienceFallback: string | null;
  interests: InterestGroup[];
  cities: BriefCity[];
  keywords: KeywordGroup[];
  facts: BriefFact[];
  angles: BriefAngle[];
  sources: { figure: string; endpoint: string; params: Record<string, string> }[];
  mock: boolean;
  createdAt: string;
}

/** Ad-platform style groups, from Qloo categories. */
const GROUP: Partial<Record<Category, string>> = {
  artist: "Music",
  tv_show: "TV and film",
  movie: "TV and film",
  podcast: "Podcasts",
  brand: "Brands and shopping",
  person: "People and creators",
  book: "Books",
};

export const label = (c: Category) => {
  const l = CATEGORY_LABEL[c] ?? c;
  return `${l.charAt(0).toUpperCase()}${l.slice(1)}s`;
};
const two = (x: number) => x.toFixed(2);

/** Interest keywords grouped for ad platforms: Qloo's names by group, Qloo's most shared genre tags, and the cities. */
export function keywordGroups(interests: readonly InterestGroup[], cities: readonly BriefCity[]): KeywordGroup[] {
  const groups = new Map<string, string[]>();
  for (const g of interests) {
    const name = GROUP[g.category] ?? g.label;
    groups.set(name, [...new Set([...(groups.get(name) ?? []), ...g.items.map((i) => i.name)])]);
  }
  const tagCount = new Map<string, number>();
  for (const i of interests.flatMap((g) => g.items)) for (const t of new Set(i.tags)) tagCount.set(t, (tagCount.get(t) ?? 0) + 1);
  const genres = [...tagCount].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([t]) => t);
  return [
    ...[...groups].map(([group, keywords]) => ({ group, keywords })),
    ...(genres.length ? [{ group: "Genres and themes", keywords: genres }] : []),
    ...(cities.length ? [{ group: "Locations", keywords: cities.map((c) => c.name) }] : []),
  ];
}

/** The facts the model may write from, numbered so each angle can cite them. No figures in the text. */
export function factsFor(d: Pick<CampaignBriefData, "fanbase" | "partner" | "audience" | "interests" | "cities">): BriefFact[] {
  const facts: BriefFact[] = [];
  const add = (text: string, name: string) => facts.push({ id: `F${facts.length + 1}`, text, name });
  if (d.partner) add(`${d.fanbase.name} fans and ${d.partner} fans share an audience (the plan's partner).`, d.partner);
  for (const g of d.interests) for (const i of g.items.slice(0, 2)) add(`${d.fanbase.name} fans over-index on ${i.name} (${g.label.toLowerCase()}).`, i.name);
  for (const c of d.cities.slice(0, 3)) add(`${c.name} is one of the strongest cities for ${d.fanbase.name} fans.`, c.name);
  if (d.audience?.skewsTo.length) add(`${d.fanbase.name} fans skew towards ages ${d.audience.skewsTo.slice(0, 2).join(" and ")}.`, d.audience.skewsTo[0]);
  return facts;
}

/** Angles from the facts by template: used when there is no model, or for any angle the model got wrong. */
export function templateAngles(facts: readonly BriefFact[]): BriefAngle[] {
  const pick = (re: RegExp) => facts.find((f) => re.test(f.text));
  const partner = pick(/share an audience/);
  const interest = facts.find((f) => /over-index on/.test(f.text) && f !== partner);
  const city = pick(/strongest cities/);
  const out: BriefAngle[] = [];
  if (partner) out.push({ title: `With ${partner.name}`, body: `Make short pieces with ${partner.name} for the fans the two already share.`, facts: [partner.id], by: "template" });
  if (interest) out.push({ title: `${interest.name} tie-in`, body: `Bring ${interest.name} into the creative: fans will recognise it straight away.`, facts: [interest.id], by: "template" });
  if (city) out.push({ title: `Start in ${city.name}`, body: `Open the campaign in ${city.name}, where the fans are strongest, then carry it to the next cities.`, facts: [city.id], by: "template" });
  const extra = facts.filter((f) => !out.some((a) => a.facts.includes(f.id)) && /over-index on/.test(f.text));
  while (out.length < 3 && extra.length) {
    const f = extra.shift()!;
    out.push({ title: `${f.name} tie-in`, body: `Borrow the look and language of ${f.name}, which these fans already follow.`, facts: [f.id], by: "template" });
  }
  return out.slice(0, 3);
}

/** Words that would bring commercial figures into the brief: never allowed in an angle. */
const FORBIDDEN = /\d|%|\$|£|€|\b(reach|impressions?|cpm|cpc|budget|ctr|roas|conversions?)\b/i;

/**
 * Checks the model's angles: three of them, each citing at least one known fact and mentioning
 * that fact's name, with no numbers or commercial figures. Any angle that fails is replaced by the
 * template angle in its place.
 */
export function checkAngles(raw: unknown, facts: readonly BriefFact[], fallback: readonly BriefAngle[]): BriefAngle[] {
  const byId = new Map(facts.map((f) => [f.id, f]));
  const list = Array.isArray(raw) ? raw.slice(0, 3) : [];
  const out: BriefAngle[] = [];
  for (let i = 0; i < 3; i++) {
    const a = list[i] as { title?: unknown; body?: unknown; facts?: unknown } | undefined;
    const title = typeof a?.title === "string" ? a.title.trim() : "";
    const body = typeof a?.body === "string" ? a.body.trim() : "";
    const cited = Array.isArray(a?.facts) ? a.facts.filter((x): x is string => typeof x === "string" && byId.has(x)) : [];
    const ok = title && body && title.length <= 80 && body.length <= 320 && cited.length > 0 && !FORBIDDEN.test(`${title} ${body}`) && cited.every((id) => body.includes(byId.get(id)!.name) || title.includes(byId.get(id)!.name));
    if (ok) out.push({ title, body, facts: cited, by: "model" });
    else if (fallback[i]) out.push(fallback[i]);
  }
  return out;
}

export interface BriefInput {
  source: CampaignBriefData["source"];
  fanbase: CampaignBriefData["fanbase"];
  partner: string | null;
  city: string | null;
  title?: string | null;
  flight?: string | null;
  audience: CampaignBriefData["audience"];
  interests: InterestGroup[];
  cities: BriefCity[];
  mock: boolean;
  now: Date;
}

export function buildBrief(input: BriefInput): CampaignBriefData {
  const base = { fanbase: input.fanbase, partner: input.partner, audience: input.audience, interests: input.interests, cities: input.cities };
  const facts = factsFor(base);
  return {
    ...base,
    title: input.title?.trim() || `${input.fanbase.name}${input.partner ? ` × ${input.partner}` : ""}: targeting brief`,
    source: input.source,
    city: input.city,
    flight: input.flight?.trim() || null,
    audienceFallback: input.audience ? null : `Qloo has no demographics for ${input.fanbase.name}, so there is no age or gender skew here. Target by the interests and cities below.`,
    keywords: keywordGroups(input.interests, input.cities),
    facts,
    angles: templateAngles(facts),
    sources: [],
    mock: input.mock,
    createdAt: input.now.toISOString(),
  };
}

/** Every number the brief shows, for the "only engine numbers" check: affinities, scores, ranks, skews. */
export function briefNumbers(b: CampaignBriefData): string[] {
  return [
    ...b.interests.flatMap((g) => g.items.map((i) => two(i.affinity))),
    ...b.cities.flatMap((c) => [String(c.score), String(c.rank), String(c.populationRank)]),
    ...(b.audience ? [two(b.audience.genderSkew), ...b.audience.bands.map((x) => two(x.skew))] : []),
    // Qloo's own age-band names ("25–29", "55 and over").
    ...(b.audience ? b.audience.bands.flatMap((x) => x.label.match(/\d+/g) ?? []) : []),
  ];
}

const skewText = (a: NonNullable<CampaignBriefData["audience"]>) =>
  `${a.skewsTo.length ? `strongest at ${a.skewsTo.slice(0, 2).join(" and ")}` : "no clear age skew"}; ${a.gender === "balanced" ? "balanced by gender" : `skews ${a.gender} (${a.genderSkew > 0 ? "+" : ""}${two(a.genderSkew)})`}`;

/** The brief as plain text, for "Copy as text". */
export function briefText(b: CampaignBriefData, workspace: string): string {
  return [
    `Targeting brief · ${workspace} · ${b.createdAt.slice(0, 10)}`,
    b.title,
    `Flight: ${b.flight ?? "to confirm"} (your data).`,
    "",
    "Audience (Qloo demographics)",
    b.audience ? `${b.audience.of} fans: ${skewText(b.audience)}` : b.audienceFallback!,
    "",
    "Top interests by category (Qloo affinity)",
    ...b.interests.map((g) => `${g.label}: ${g.items.map((i) => `${i.name} ${two(i.affinity)}`).join(", ")}`),
    "",
    "Strongest cities",
    ...b.cities.map((c, i) => `${String(i + 1).padStart(2, "0")} ${c.name} ${c.score}/100 · Qloo #${c.rank}, population #${c.populationRank}${c.note ? ` · ${c.note}` : ""}`),
    "",
    "Interest keywords for ad platforms",
    ...b.keywords.map((k) => `${k.group}: ${k.keywords.join(", ")}`),
    "",
    "Creative angles",
    ...b.angles.map((a) => `${a.title}: ${a.body} (from ${a.facts.join(", ")}${a.by === "template" ? "; template" : ""})`),
    "",
    "Facts the angles use",
    ...b.facts.map((f) => `${f.id}. ${f.text}`),
    "",
    "No reach, impressions, CPM or budget figures: those come from the ad platform, not from Qloo.",
  ].join("\n");
}

const csvCell = (v: string | number) => {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Keywords and cities as CSV, for ad platform uploads. */
export function briefCsv(b: CampaignBriefData): string {
  const affinity = new Map(b.interests.flatMap((g) => g.items.map((i) => [i.name, two(i.affinity)] as const)));
  const rows: (string | number)[][] = [["type", "group", "value", "qloo_affinity_0_1", "city_score_0_100"]];
  for (const k of b.keywords) {
    if (k.group === "Locations") continue;
    for (const w of k.keywords) rows.push(["keyword", k.group, w, affinity.get(w) ?? "", ""]);
  }
  for (const c of b.cities) rows.push(["city", "Locations", c.name, "", c.score]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/** The brief as deck slides (rendered with the workspace's branded deck settings). */
export function briefOutline(b: CampaignBriefData): SlideOutline[] {
  return [
    { title: b.title, subtitle: `Targeting brief · ${b.fanbase.name}${b.city ? ` · ${b.city}` : ""}`, note: `Flight: ${b.flight ?? "to confirm"} (your data). No reach, impressions, CPM or budget figures.` },
    { title: "Audience", bullets: [b.audience ? `${b.audience.of} fans: ${skewText(b.audience)}` : b.audienceFallback!], note: "Qloo demographics" },
    { title: "Top interests by category", bullets: b.interests.map((g) => `${g.label}: ${g.items.map((i) => `${i.name} (${two(i.affinity)})`).join(", ")}`), note: "Qloo affinity among the fans, 0–1" },
    { title: "Strongest cities", bullets: b.cities.map((c) => `${c.name}: ${c.score} / 100 · Qloo #${c.rank}, population #${c.populationRank}`), note: "Engine city score from Qloo heat" },
    { title: "Interest keywords", bullets: b.keywords.map((k) => `${k.group}: ${k.keywords.join(", ")}`) },
    { title: "Creative angles", bullets: b.angles.map((a) => `${a.title}: ${a.body}`), note: `From facts ${[...new Set(b.angles.flatMap((a) => a.facts))].join(", ")}` },
    { title: "Sources", bullets: [...b.facts.map((f) => `${f.id}. ${f.text}`), ...b.sources.map((s) => `${s.figure}: ${s.endpoint}`)] },
  ];
}
