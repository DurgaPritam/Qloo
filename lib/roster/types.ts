import type { Category, Confidence, Entity } from "@/lib/engine/types";
import type { RosterPair, UnscoredPair } from "@/lib/engine/roster";

/** The resolver's entity, as stored on a roster act (aliases dropped). */
export type RosterEntity = Pick<Entity, "id" | "name" | "category" | "popularity" | "description" | "disambiguation" | "homeCountry" | "tags">;

/** A Qloo request as the UI shows it (never the key). */
export interface CallRecord {
  endpoint: string;
  params: Record<string, string>;
  cached: boolean;
}

export interface ProfilePick {
  id: string;
  name: string;
  /** Engine score of the pick (scorePartners or rankBrands). */
  score: number;
  confidence: Confidence;
  /** What the score is built from: Qloo affinity and popularity, and affinity relative to its group. Absent on profiles cached before it was recorded. */
  evidence?: { affinity: number; popularity: number; relativeAffinity: number };
}

/**
 * One act's Qloo picks, built by engine functions only (lib/roster/profile.ts) and cached per
 * entity for a week.
 */
export interface ActProfile {
  entityId: string;
  /** ISO code of the market the city was picked in: the act's home country, else the default. */
  market: string;
  city: {
    id: string;
    name: string;
    country: string;
    confidence: Confidence;
    /** Mean Qloo heat (affinity × presence) of the cells near the city, and how many cells. */
    evidence?: { heat: number; cells: number };
  } | null;
  /** Per-city heat in the market, [mean, cells] by city id, for cities with any heat. */
  heat: Record<string, [number, number]>;
  partner: (ProfilePick & { category: Category }) | null;
  sponsor: ProfilePick | null;
  /** The weakest of the three picks (lib/engine/roster.ts, actConfidence). */
  confidence: Confidence;
  /** What could not be found, in plain words. */
  notes: string[];
  /** The Qloo requests the profile was built from. */
  calls?: CallRecord[];
  mock: boolean;
}

export interface RosterActView {
  id: string;
  entityId: string;
  name: string;
  category: Category;
  /** "Comedian", "Music artist"…, from the resolver. */
  kind: string;
  homeCity: string | null;
  profile: ActProfile | null;
  profileAt: string | null;
  /** True when the profile or the pairings for this act are missing or older than a week. */
  stale: boolean;
  /** The filter.results.entities requests behind this act's side of its pairings. */
  pairingCalls: CallRecord[];
}

export interface RefreshEstimate {
  /** Upper bound on uncached Qloo calls; cache hits make it less. */
  calls: number;
  acts: number;
  profiles: number;
  pairings: number;
  /** Batches of at most one run's budget; more than one goes through the job queue. */
  batches: number;
}

export interface RosterJobView {
  id: string;
  /** Upper bound on calls planned for this batch, before it ran. */
  estimate: number | null;
  status: "queued" | "running" | "done" | "failed" | "skipped_budget";
  note: string | null;
  qlooCalls: number;
  createdAt: string;
  finishedAt: string | null;
}

export interface RosterView {
  id: string;
  name: string;
  acts: RosterActView[];
  pairs: RosterPair[];
  unscored: UnscoredPair[];
  /** Pairs not yet asked of Qloo (an act added since the last refresh). */
  pendingPairs: number;
  estimate: { stale: RefreshEstimate; all: RefreshEstimate };
  usage: { used: number; allowance: number; remaining: number; dailyRemaining: number | null };
  /** The latest refresh's jobs, newest first. */
  jobs: RosterJobView[];
  canEdit: boolean;
  mock: boolean;
}
