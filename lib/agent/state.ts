import type { Candidate, Category, City, Entity, HeatCell } from "@/lib/engine/types";
import type { MatchResult } from "@/lib/engine/match";

import type {
  Brief,
  CityResult,
  Email,
  FormatChoice,
  NeedsInput,
  Overrides,
  PartnerResult,
  RoomResult,
} from "./types";

/** Everything a run has learned so far. Tools read and write it; the plan is built from it. */
export interface RunState {
  query: string;
  overrides: Overrides;
  match: MatchResult | null;
  fanbase: Entity | null;
  needsInput: NeedsInput | null;
  format: FormatChoice | null;
  candidates: Map<Category, Candidate[]>;
  partners: PartnerResult | null;
  partner: Candidate | null;
  partnersWidened: boolean;
  heat: { partnerId: string; market: string; a: HeatCell[]; b: HeatCell[] } | null;
  city: CityResult | null;
  chosenCity: City | null;
  cityWidened: boolean;
  room: RoomResult | null;
  brief: Brief | null;
  outreach: Email[] | null;
  notes: string[];
  /** Set when the run must pause for the user. */
  stopped: boolean;
  budgetHit: boolean;
}

export function newRunState(query: string, overrides: Overrides = {}): RunState {
  return {
    query,
    overrides,
    match: null,
    fanbase: null,
    needsInput: null,
    format: null,
    candidates: new Map(),
    partners: null,
    partner: null,
    partnersWidened: false,
    heat: null,
    city: null,
    chosenCity: null,
    cityWidened: false,
    room: null,
    brief: null,
    outreach: null,
    notes: [],
    stopped: false,
    budgetHit: false,
  };
}
