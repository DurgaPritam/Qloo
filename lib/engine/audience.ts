import { ENGINE_CONFIG } from "./config";
import type { Demographics } from "./types";

export const AGE_LABEL: Record<string, string> = {
  "24_and_younger": "24 and under",
  "25_to_29": "25–29",
  "30_to_34": "30–34",
  "35_to_44": "35–44",
  "45_to_54": "45–54",
  "55_and_older": "55 and over",
};

export interface AudienceSummary {
  /** Age bands with a positive skew, strongest first. */
  skewsTo: string[];
  gender: "female" | "male" | "balanced";
  genderSkew: number;
  /** In Qloo's band order, for the bars. */
  bands: Array<{ key: string; label: string; skew: number }>;
}

/** Plain-language reading of Qloo's skews; every number shown comes from Qloo. */
export function summariseAudience(d: Demographics, lean = ENGINE_CONFIG.audience.lean): AudienceSummary {
  const bands = Object.keys(AGE_LABEL)
    .filter((k) => typeof d.age[k] === "number")
    .map((key) => ({ key, label: AGE_LABEL[key], skew: d.age[key] }));
  const skewsTo = bands
    .filter((b) => b.skew >= lean)
    .sort((a, b) => b.skew - a.skew)
    .map((b) => b.label);
  const female = d.gender.female ?? 0;
  return {
    skewsTo,
    gender: Math.abs(female) < lean ? "balanced" : female > 0 ? "female" : "male",
    genderSkew: female,
    bands,
  };
}
