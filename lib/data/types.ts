import type { Category } from "@/lib/engine/types";

/** Metric columns a user can map; "other" keeps the column's own name. */
export const METRIC_KINDS = ["tickets", "streams", "signups", "revenue", "other"] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export const METRIC_LABEL: Record<MetricKind, string> = {
  tickets: "Tickets sold",
  streams: "Streams",
  signups: "Signups",
  revenue: "Revenue",
  other: "Other metric",
};

/** What a column is used for, chosen in the mapping step. */
export type ColumnRole = { role: "city" } | { role: "country" } | { role: "metric"; kind: MetricKind } | { role: "ignore" };

export interface MetricDef {
  /** Stable key in dataset_rows.metrics. */
  key: string;
  kind: MetricKind;
  /** "Tickets sold", or the column's name for "other". */
  label: string;
  column: string;
}

export interface CityOption {
  id: string;
  name: string;
  admin1: string;
  country: string;
}

/** One city name from the file that needs a person: ambiguous or not found. */
export interface ReviewItem {
  rawCity: string;
  rawCountry: string | null;
  status: "ambiguous" | "unmatched";
  rows: number;
  options: CityOption[];
}

export interface DatasetSummary {
  id: string;
  name: string;
  fileKind: "csv" | "xlsx";
  metrics: MetricDef[];
  rows: number;
  matchedRows: number;
  review: number;
  entity: { id: string; name: string; category: Category } | null;
  uploadedAt: string;
  uploadedBy: string | null;
}

export interface CityInfo {
  id: string;
  name: string;
  admin1: string;
  country: string;
  lat: number;
  lon: number;
}

/**
 * What the ranking needs; the browser combines it with combineCityScores (engine code) as the
 * weight slider moves. Never sent outside the workspace.
 */
export interface RankingData {
  /** Qloo's score per city (0–1), or null when no fanbase is attached. */
  qloo: { cityId: string; score: number }[] | null;
  /** Where the Qloo score comes from, for the column's label. */
  qlooLabel: string;
  metrics: { key: string; label: string }[];
  /** Metric key → value summed per matched city. */
  totals: Record<string, { cityId: string; value: number }[]>;
  cities: CityInfo[];
}

export interface DatasetView {
  summary: DatasetSummary;
  review: ReviewItem[];
  ranking: RankingData;
  canEdit: boolean;
  /** Set when Qloo could not be asked (budget, outage); the ranking then shows your data only. */
  qlooNote: string | null;
}
