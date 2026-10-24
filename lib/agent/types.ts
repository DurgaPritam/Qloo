import type { FormatId } from "@/lib/engine/config";
import type {
  BrandPick,
  Category,
  CityScore,
  Confidence,
  Entity,
  PartnerPick,
  PlacePick,
} from "@/lib/engine/types";

export type StepId = "identify" | "format" | "partners" | "city" | "room" | "brief" | "outreach";

export const STEPS: ReadonlyArray<{ id: StepId; title: string }> = [
  { id: "identify", title: "Identify fanbase" },
  { id: "format", title: "Choose format" },
  { id: "partners", title: "Find crossover partners" },
  { id: "city", title: "Pick the city" },
  { id: "room", title: "Pick room & sponsors" },
  { id: "brief", title: "Write the brief" },
  { id: "outreach", title: "Draft outreach" },
];

export type StepStatus = "running" | "done" | "fallback" | "error" | "needs_input";

export const TO_CONFIRM = "to confirm with the promoter";

/** What the UI shows for one Qloo call. Never contains a key. */
export interface QlooCallView {
  endpoint: string;
  params: Record<string, string>;
  cached: boolean;
  ms: number;
}

/** One SSE event. `qlooCall` is the step's first call; `qlooCalls` lists all of them. */
export interface AgentEvent {
  step: StepId | "final";
  status: StepStatus;
  summary: string;
  qlooCall: QlooCallView | null;
  qlooCalls?: QlooCallView[];
  data?: unknown;
  /** True when the step changed course (widened, asked, swapped city). */
  branch?: boolean;
  /** The agent's own one-line remark before the call, sanitised. */
  note?: string;
  /** Sample data: the UI must show the banner. */
  mock: boolean;
}

export interface Overrides {
  entityId?: string;
  partnerId?: string;
  cityId?: string;
}

export interface Choice {
  entityId: string;
  name: string;
  category: Category;
  imageUrl?: string;
  /** One disambiguating detail, e.g. "film". */
  detail: string;
}

export interface NeedsInput {
  kind: "ambiguous" | "did_you_mean" | "none";
  question: string;
  choices: Choice[];
}

export interface FormatChoice {
  format: FormatId;
  label: string;
  minPopulation: number;
  venueTags: readonly string[];
  spotTags: readonly string[];
}

export interface Explained<P> {
  pick: P;
  explanation: string;
}

export interface PartnerResult {
  picks: Explained<PartnerPick>[];
  chosenId: string | null;
  fallback: boolean;
  reason: string;
  categoriesTried: Category[];
  droppedCount: number;
}

export interface CityResult {
  /** Top cities by combined score, for the table and map. */
  table: Explained<CityScore>[];
  chosen: Explained<CityScore> | null;
  /** The city a population-only planner would pick. */
  populationPick: CityScore | null;
  /** Up to ten cities for the map, best first. */
  map: Array<{ id: string; name: string; lat: number; lon: number; combined: number }>;
  level: "city" | "region";
  fallback: boolean;
  reason: string;
}

export interface RoomResult {
  /** The city the room is in; differs from the chosen city when the nearest one was used. */
  cityName: string;
  movedFrom: { cityName: string; distanceKm: number } | null;
  venue: Explained<PlacePick> | null;
  opener: Explained<PartnerPick> | null;
  spots: Explained<PlacePick>[];
  sponsors: Explained<BrandPick>[];
  toConfirm: Array<{ item: string; value: typeof TO_CONFIRM }>;
  fallback: boolean;
  reason: string;
}

export interface BriefItem {
  label: string;
  name: string;
  /** Model prose, sanitised; never holds numbers. */
  reason: string;
  /** Engine sentence with the numbers. */
  evidence: string;
  source: string;
  confidence: Confidence;
}

export interface Brief {
  title: string;
  headline: string;
  format: string;
  items: BriefItem[];
  toConfirm: Array<{ item: string; value: typeof TO_CONFIRM }>;
  /** True when the prose came from templates rather than the model. */
  templated: boolean;
}

export interface Email {
  to: "partner" | "venue";
  recipient: string;
  subject: string;
  body: string;
}

export interface Plan {
  runId: string;
  query: string;
  mock: boolean;
  planner: "claude" | "scripted";
  status: "complete" | "needs_input" | "incomplete";
  fanbase: Entity | null;
  needsInput: NeedsInput | null;
  format: FormatChoice | null;
  partners: PartnerResult | null;
  city: CityResult | null;
  room: RoomResult | null;
  brief: Brief | null;
  outreach: Email[] | null;
  /** Labelled notes on fallbacks and caps, in order. */
  notes: string[];
  qlooCalls: number;
  turns: number;
}
