import { TO_CONFIRM_COMMERCIAL, type SponsorFit } from "@/lib/engine/sponsor";
import { MOCK_BANNER } from "@/lib/mock-mode";

import type { SlideOutline } from "./outline";

/**
 * A sponsorship pitch deck, built from engine output only: the fit (scoreSponsorFit), its Qloo
 * evidence, the audience reading (summariseAudience) and city scores. The pitch wording is a
 * template filled with those values; nothing commercial is estimated.
 */
export interface PitchInput {
  /** The act, team, event or roster selling the sponsorship. */
  holder: string;
  brand: string;
  sector?: string;
  fit: SponsorFit;
  /** Whose audience the reading describes, and Qloo's skews as summariseAudience reads them. */
  audience: { of: string; skewsTo: string[]; gender: "female" | "male" | "balanced" } | null;
  /** City scores 0–1 from scoreCities, best first. */
  cities: { name: string; score: number }[];
  /** The Qloo request behind each figure, for the Sources slide. Absent on matches saved before it existed. */
  sources?: PitchSource[];
  mock: boolean;
}

export interface PitchSource {
  /** Which figure: "Fit, forward", "Cities", "Audience"… */
  figure: string;
  endpoint: string;
  params: Record<string, string>;
}

/** The parameters that say what was asked: type, signal, targets, place. */
const KEY_PARAMS = ["filter.type", "signal.interests.entities", "filter.results.entities", "filter.location.query", "signal.location.query", "query"];
export function describeRequest(s: Pick<PitchSource, "endpoint" | "params">): string {
  const parts = KEY_PARAMS.filter((k) => s.params[k]).map((k) => `${k}=${s.params[k]}`);
  return `GET ${s.endpoint}${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
}

const pct = (x: number) => String(Math.round(x * 100));
const list = (xs: readonly string[]) => (xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

export function pitchFooter(p: Pick<PitchInput, "mock">): string {
  return p.mock ? MOCK_BANNER : "Fit and evidence computed by Takeover from Qloo taste data.";
}

export function pitchFileName(p: Pick<PitchInput, "holder" | "brand" | "mock">): string {
  const base = `${p.holder}-${p.brand}-pitch`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70);
  return `${base}${p.mock ? "-sample" : ""}.pptx`;
}

/** The pitch in words: only the names, the fit and Qloo's values. */
export function pitchText(p: PitchInput): string {
  const f = p.fit;
  const parts = [
    `${p.holder} and ${p.brand} share an audience.`,
    f.forward !== null ? `Qloo puts ${p.brand} at an affinity of ${f.forward.toFixed(2)} among ${p.holder} fans.` : "",
    f.backward !== null ? `It puts ${p.holder} at ${f.backward.toFixed(2)} among ${p.brand} fans.` : "",
    p.cities.length ? `The audience is strongest in ${list(p.cities.slice(0, 3).map((c) => c.name))}.` : "",
    `We would like to explore a partnership that puts ${p.brand} in front of these fans.`,
  ];
  return parts.filter(Boolean).join(" ");
}

export function pitchOutline(p: PitchInput): SlideOutline[] {
  const f = p.fit;
  const slides: SlideOutline[] = [
    {
      title: `${p.holder} × ${p.brand}`,
      subtitle: `Sponsorship pitch${p.sector && p.sector !== "Other" ? ` · ${p.sector}` : ""} · fit ${f.fit} / 100, ${f.confidence} confidence`,
    },
    {
      title: "Why it fits",
      bullets: f.evidence.filter((e) => e.kind !== "to_confirm").map((e) => e.text),
      note: "Fit = the mean of Qloo's affinity in each direction measured, × 100.",
    },
  ];
  if (p.audience) {
    const who = [p.audience.skewsTo.length ? `most often aged ${list(p.audience.skewsTo.slice(0, 2))}` : "", p.audience.gender === "balanced" ? "" : `skewing ${p.audience.gender}`].filter(Boolean).join(", ");
    slides.push({ title: "The audience", bullets: [who ? `${p.audience.of} fans are ${who}.` : `${p.audience.of} fans have no strong age or gender skew.`], note: "Qloo demographics: skew against the general population." });
  }
  if (p.cities.length) {
    slides.push({
      title: "Where the fans are",
      table: { columns: ["City", "Qloo heat"], rows: p.cities.slice(0, 5).map((c) => [c.name, `${pct(c.score)} / 100`]) },
      note: "Heat scaled to the hottest city in the market.",
    });
  }
  slides.push({ title: "The pitch", bullets: [pitchText(p)], note: TO_CONFIRM_COMMERCIAL });
  if (p.sources?.length) {
    slides.push({
      title: "Sources",
      table: { columns: ["Figure", "Qloo request"], rows: p.sources.map((s) => [s.figure, describeRequest(s)]) },
      note: "Every figure in this deck is a Qloo value from the request beside it, or computed from those values by Takeover's engine.",
    });
  }
  return slides;
}

/** Every number the deck may contain: the fit, Qloo's values, city scores and Qloo's age bands. */
export function pitchNumbers(p: PitchInput): Set<string> {
  const nums = new Set<string>([String(p.fit.fit), "100"]);
  for (const v of [p.fit.forward, p.fit.backward]) if (v !== null) nums.add(v.toFixed(2));
  for (const c of p.cities) nums.add(pct(c.score));
  for (const band of p.audience?.skewsTo ?? []) for (const n of band.match(/\d+/g) ?? []) nums.add(n);
  // Digits inside the requests' entity ids and place names on the Sources slide.
  for (const s of p.sources ?? []) for (const n of describeRequest(s).match(/\d+(?:\.\d+)?/g) ?? []) nums.add(n);
  return nums;
}
