import type { Plan } from "@/lib/agent/types";
import type { AudienceSummary } from "@/lib/engine/audience";
import { CATEGORY_LABEL } from "@/lib/engine/explain";

/**
 * A one-page campaign brief from a saved plan: the audience (Qloo demographics), what the fans
 * over-index on (the plan's own Qloo picks), the plan's cities, and three creative angles. Every
 * number is Qloo's or the engine's, as stored with the plan; budget and flight are the user's,
 * labelled, and "to confirm" when empty. The model may only rephrase an angle's sentence.
 */
export interface BriefAudience {
  of: string;
  /** Age bands with a positive skew, strongest first (Qloo). */
  skewsTo: string[];
  gender: "female" | "male" | "balanced";
  genderSkew: number;
}

export interface BriefInterest {
  name: string;
  category: string;
  /** 0–1, Qloo affinity among the fanbase's fans. */
  affinity: number;
  /** Where it came from in the plan. */
  from: "partner shortlist" | "sponsors" | "opener";
}

export interface CampaignBriefData {
  title: string;
  planId: string;
  fanbase: string;
  partner: string | null;
  city: string | null;
  /** The user's own fields; null → "to confirm". */
  yours: { flight: string | null; budget: string | null };
  /** Plan's partner affinity (Qloo), 0–1. */
  partnerAffinity: number | null;
  audience: BriefAudience[];
  interests: BriefInterest[];
  cities: { name: string; score: number; rank: number; populationRank: number; note: string | null }[];
  angles: { title: string; body: string; source: string }[];
  /** The Qloo requests behind the audience (the rest come from the plan's own requests). */
  sources: { figure: string; endpoint: string; params: Record<string, string> }[];
  mock: boolean;
  createdAt: string;
}

const label = (c: string) => {
  const l = CATEGORY_LABEL[c as keyof typeof CATEGORY_LABEL] ?? c;
  return l.charAt(0).toUpperCase() + l.slice(1);
};
const two = (x: number) => x.toFixed(2);

/** What the fans over-index on, from the plan: the partner shortlist, sponsors and opener, best first. */
export function interestsFromPlan(plan: Plan, max = 6): BriefInterest[] {
  const out: BriefInterest[] = [];
  for (const p of plan.partners?.picks ?? []) out.push({ name: p.pick.entity.name, category: label(p.pick.entity.category), affinity: p.pick.evidence.affinity, from: "partner shortlist" });
  for (const s of plan.room?.sponsors ?? []) out.push({ name: s.pick.brand.name, category: "Brand", affinity: s.pick.evidence.affinity, from: "sponsors" });
  const opener = plan.room?.opener;
  if (opener) out.push({ name: opener.pick.entity.name, category: label(opener.pick.entity.category), affinity: opener.pick.evidence.affinity, from: "opener" });
  const seen = new Set<string>();
  return out
    .filter((i) => Number.isFinite(i.affinity) && !seen.has(i.name) && seen.add(i.name))
    .sort((a, b) => b.affinity - a.affinity || a.name.localeCompare(b.name))
    .slice(0, max);
}

/** Three angles, each tied to one Qloo fact; the sentences carry no numbers. */
export function anglesFor(d: Pick<CampaignBriefData, "fanbase" | "partner" | "partnerAffinity" | "interests" | "cities">) {
  const angles: CampaignBriefData["angles"] = [];
  if (d.partner && d.partnerAffinity !== null) {
    angles.push({
      title: `${d.partner} crossover`,
      body: `Make short pieces with ${d.partner} that land in each city before tickets go on sale.`,
      source: `${d.partner} · Qloo affinity ${two(d.partnerAffinity)}`,
    });
  }
  const interest = d.interests.find((i) => i.name !== d.partner);
  if (interest) {
    angles.push({
      title: `${interest.name} tie-in`,
      body: `Bring ${interest.name} into the night itself: a pop-up, a playlist or a guest spot that fans will recognise.`,
      source: `${interest.category} · Qloo affinity ${two(interest.affinity)}`,
    });
  }
  const city = d.cities[0];
  if (city) {
    angles.push({
      title: `First night in ${city.name}`,
      body: `Open in ${city.name} with a fan meetup near the venue after the show, then carry the clips to the next stops.`,
      source: `${city.name} · ${city.score} / 100`,
    });
  }
  return angles;
}

export function buildBrief(
  plan: Plan,
  input: { planId: string; title?: string | null; flight?: string | null; budget?: string | null; audience: (AudienceSummary & { of: string })[]; cityNotes?: Record<string, string>; now: Date },
): CampaignBriefData {
  const chosen = plan.partners?.picks.find((p) => p.pick.entity.id === plan.partners?.chosenId)?.pick ?? null;
  const fanbase = plan.fanbase?.name ?? plan.query;
  const partner = chosen?.entity.name ?? null;
  const cityName = plan.room?.cityName ?? plan.city?.chosen?.pick.city.name ?? null;
  const cities = (plan.city?.table ?? []).slice(0, 5).map((t) => ({
    name: t.pick.city.name,
    score: Math.round(t.pick.combined * 100),
    rank: t.pick.rank,
    populationRank: t.pick.populationRank,
    note: input.cityNotes?.[t.pick.city.id] ?? null,
  }));
  const base = {
    fanbase,
    partner,
    partnerAffinity: chosen?.evidence.affinity ?? null,
    interests: interestsFromPlan(plan),
    cities,
  };
  return {
    title: input.title?.trim() || `${fanbase}${partner ? ` × ${partner}` : ""}${cityName ? ` in ${cityName}` : ""}`,
    planId: input.planId,
    city: cityName,
    yours: { flight: input.flight?.trim() || null, budget: input.budget?.trim() || null },
    audience: input.audience.map((a) => ({ of: a.of, skewsTo: a.skewsTo, gender: a.gender, genderSkew: a.genderSkew })),
    angles: anglesFor(base),
    sources: [],
    mock: plan.mock,
    createdAt: input.now.toISOString(),
    ...base,
  };
}

/** The brief as plain text, for "Copy as text". */
export function briefText(b: CampaignBriefData, workspace: string): string {
  const skew = (a: BriefAudience) => `${a.of} fans: ${a.skewsTo.length ? `strongest at ${a.skewsTo.slice(0, 2).join(" and ")}` : "no clear age skew"}; ${a.gender === "balanced" ? "balanced by gender" : `skews ${a.gender} (${a.genderSkew > 0 ? "+" : ""}${two(a.genderSkew)})`}`;
  return [
    `Campaign brief · ${workspace} · ${b.createdAt.slice(0, 10)}`,
    b.title,
    "",
    `Flight: ${b.yours.flight ?? "to confirm"} (your data). Budget: ${b.yours.budget ?? "to confirm"} (your data).`,
    "",
    "Audience (Qloo)",
    ...b.audience.map(skew),
    ...(b.partner && b.partnerAffinity !== null ? [`${b.fanbase} fans' affinity for ${b.partner}: ${two(b.partnerAffinity)}`] : []),
    "",
    "Interests · Qloo affinity",
    ...b.interests.map((i) => `${i.name} (${i.category}): ${two(i.affinity)}`),
    "",
    "Cities",
    ...b.cities.map((c, i) => `${String(i + 1).padStart(2, "0")} ${c.name} ${c.score}/100 · Qloo #${c.rank}, population #${c.populationRank}${c.note ? ` · ${c.note}` : ""}`),
    "",
    "Creative angles",
    ...b.angles.map((a) => `${a.title}: ${a.body} (${a.source})`),
    "",
    "Sources: Qloo /v2/insights (the plan's requests) and demographics. Venue, capacity, dates and prices to confirm with the promoter.",
  ].join("\n");
}
