import type { Category } from "@/lib/engine/types";

/**
 * The Tour planner's itinerary: an ordered list of stops the user edits by hand or through the
 * AI edit box. Qloo values (a stop's heat, a suggested venue's score) keep their evidence and are
 * labelled Qloo signal; anything the user typed is source "user" (Your data). Dates are either the
 * user's (pinned) or drafted by code from the user's own start date (lib/itinerary/schedule.ts);
 * the model never produces one. Leg distances are always recomputed from coordinates.
 */

export const ITINERARY_LIMITS = {
  stops: 30,
  contacts: 12,
  shows: 14,
  restAfter: 30,
  pace: { min: 100, max: 2000 },
  text: 200,
  notes: 1000,
  /** Serialised size cap for a saved itinerary, in characters. */
  bytes: 120_000,
} as const;

export const DEFAULT_PACE_KM = 500;

export interface StopCity {
  /** GeoNames id (lib/engine/data), as the engine uses. */
  id: string;
  name: string;
  /** First-level region, e.g. "Colorado"; may be empty. */
  admin1: string;
  country: string;
  lat: number;
  lon: number;
}

/** The fanbase's heat in the city, from the Tour optimizer's route (Qloo signal, engine-scaled). */
export interface StopHeat {
  /** 0–1. */
  score: number;
  cells: number;
  /** What the score is scaled against, for the evidence line. */
  against: string;
  /** The Qloo call behind it, e.g. "GET /v2/insights · filter.type=urn:heatmap …". */
  call?: string;
}

/** A venue, support act or sponsor: the user's own, or one they picked from Qloo suggestions. */
export interface Picked {
  name: string;
  source: "user" | "qloo";
  qlooId?: string;
  /** 0–1, the engine's score for a Qloo pick; never set on a user value. */
  score?: number;
  evidence?: string;
}

export interface Contact {
  id: string;
  role: string;
  name: string;
  email: string;
  phone: string;
}

export type StopField = "venue" | "support" | "sponsor";

export interface ItineraryStop {
  id: string;
  city: StopCity;
  /** Null for a stop the user added that the route did not score. */
  heat: StopHeat | null;
  /** Why it is on the tour: the optimizer's role, or "added" by the user. */
  role: "start" | "end" | "included" | "chosen" | "added";
  /** A date the user set ("YYYY-MM-DD"), pinning this stop; "" when drafted. */
  date: string;
  shows: number;
  restAfter: number;
  venue: Picked | null;
  support: Picked | null;
  sponsor: Picked | null;
  contacts: Contact[];
  notes: string;
}

export interface Itinerary {
  v: 1;
  name: string;
  fanbase: { id: string; name: string; category: Category };
  /** The user's start date ("YYYY-MM-DD"), or "" before they set one. */
  startDate: string;
  /** The user's driving pace, km per travel day. */
  kmPerTravelDay: number;
  stops: ItineraryStop[];
  /** Made from sample data (TAKEOVER_MOCK). */
  mock: boolean;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (x: unknown): x is string => typeof x === "string" && DATE.test(x) && !Number.isNaN(Date.parse(`${x}T00:00:00Z`)) && new Date(`${x}T00:00:00Z`).toISOString().startsWith(x);

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`);

export function emptyStop(city: StopCity, id = newId()): ItineraryStop {
  return { id, city, heat: null, role: "added", date: "", shows: 1, restAfter: 0, venue: null, support: null, sponsor: null, contacts: [], notes: "" };
}

/* ---------- Validation (server side before saving; also for anything read from localStorage) ---------- */

const str = (x: unknown, max: number = ITINERARY_LIMITS.text) => (typeof x === "string" ? x.trim().slice(0, max) : "");
const int = (x: unknown, min: number, max: number, fallback: number) => (typeof x === "number" && Number.isInteger(x) && x >= min && x <= max ? x : fallback);
const unit = (x: unknown) => (typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1 ? x : null);
const obj = (x: unknown) => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null);
const CATEGORIES: readonly Category[] = ["artist", "person", "movie", "tv_show", "podcast", "brand", "book", "videogame", "place"];

function city(x: unknown): StopCity | null {
  const c = obj(x);
  if (!c) return null;
  const id = str(c.id, 40);
  const name = str(c.name, 100);
  const lat = c.lat;
  const lon = c.lon;
  if (!id || !name || typeof lat !== "number" || typeof lon !== "number" || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { id, name, admin1: str(c.admin1, 100), country: str(c.country, 2).toUpperCase(), lat, lon };
}

function picked(x: unknown): Picked | null {
  const p = obj(x);
  const name = p ? str(p.name) : "";
  if (!p || !name) return null;
  if (p.source !== "qloo") return { name, source: "user" };
  const score = unit(p.score);
  return { name, source: "qloo", ...(str(p.qlooId, 100) ? { qlooId: str(p.qlooId, 100) } : {}), ...(score !== null ? { score } : {}), ...(str(p.evidence, 300) ? { evidence: str(p.evidence, 300) } : {}) };
}

function heat(x: unknown): StopHeat | null {
  const h = obj(x);
  const score = h ? unit(h.score) : null;
  if (!h || score === null) return null;
  return { score, cells: int(h.cells, 0, 100_000, 0), against: str(h.against, 200), ...(str(h.call, 400) ? { call: str(h.call, 400) } : {}) };
}

function contact(x: unknown): Contact | null {
  const c = obj(x);
  if (!c) return null;
  const name = str(c.name, 120);
  if (!name) return null;
  return { id: str(c.id, 60) || newId(), role: str(c.role, 60), name, email: str(c.email, 160), phone: str(c.phone, 60) };
}

const ROLES = new Set(["start", "end", "included", "chosen", "added"]);

function stop(x: unknown): ItineraryStop | null {
  const s = obj(x);
  const c = s && city(s.city);
  if (!s || !c) return null;
  return {
    id: str(s.id, 60) || newId(),
    city: c,
    heat: heat(s.heat),
    role: (ROLES.has(s.role as string) ? s.role : "added") as ItineraryStop["role"],
    date: isIsoDate(s.date) ? s.date : "",
    shows: int(s.shows, 1, ITINERARY_LIMITS.shows, 1),
    restAfter: int(s.restAfter, 0, ITINERARY_LIMITS.restAfter, 0),
    venue: picked(s.venue),
    support: picked(s.support),
    sponsor: picked(s.sponsor),
    contacts: (Array.isArray(s.contacts) ? s.contacts : []).slice(0, ITINERARY_LIMITS.contacts).map(contact).filter((v): v is Contact => v !== null),
    notes: str(s.notes, ITINERARY_LIMITS.notes),
  };
}

/**
 * An itinerary from untrusted JSON (a request body, localStorage), with every field checked and
 * clamped; null when it is not one or is over the size cap. Unknown fields are dropped.
 */
export function parseItinerary(x: unknown): Itinerary | null {
  const it = obj(x);
  if (!it) return null;
  try {
    if (JSON.stringify(it).length > ITINERARY_LIMITS.bytes) return null;
  } catch {
    return null;
  }
  const fb = obj(it.fanbase);
  const fanbase = fb && str(fb.id, 100) && str(fb.name, 100) ? { id: str(fb.id, 100), name: str(fb.name, 100), category: (CATEGORIES.includes(fb.category as Category) ? fb.category : "artist") as Category } : null;
  if (!fanbase || !Array.isArray(it.stops) || it.stops.length > ITINERARY_LIMITS.stops) return null;
  const stops = it.stops.map(stop);
  if (stops.some((s) => s === null)) return null;
  const ids = new Set(stops.map((s) => s!.id));
  if (ids.size !== stops.length) return null;
  return {
    v: 1,
    name: str(it.name, 120) || `${fanbase.name} tour`,
    fanbase,
    startDate: isIsoDate(it.startDate) ? it.startDate : "",
    kmPerTravelDay: int(it.kmPerTravelDay, ITINERARY_LIMITS.pace.min, ITINERARY_LIMITS.pace.max, DEFAULT_PACE_KM),
    stops: stops as ItineraryStop[],
    mock: it.mock === true,
  };
}
