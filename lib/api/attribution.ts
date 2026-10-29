/**
 * The source attribution every public API response and widget carries. The exact wording Qloo's
 * agreement requires is to be confirmed with Qloo; it is set here, once.
 */
export const ATTRIBUTION = {
  source: "Qloo",
  text: "Taste data from Qloo",
  url: "https://www.qloo.com",
  note: "Scores and rankings are computed by Takeover from Qloo data.",
} as const;

export type Attribution = typeof ATTRIBUTION;
