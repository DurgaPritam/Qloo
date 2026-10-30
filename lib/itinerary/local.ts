import { parseItinerary, type Itinerary } from "./types";

/** Itineraries this browser keeps when signed out. In localStorage only: nothing on our server. */
export interface LocalItinerary {
  key: string;
  name: string;
  savedAt: string;
  itinerary: Itinerary;
}

const KEY = "takeover:itineraries:v1";
const MAX = 20;

export function loadLocalItineraries(): LocalItinerary[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((x: Partial<LocalItinerary>) => {
      const itinerary = parseItinerary(x?.itinerary);
      return itinerary && typeof x.key === "string" ? [{ key: x.key, name: itinerary.name, savedAt: typeof x.savedAt === "string" ? x.savedAt : "", itinerary }] : [];
    });
  } catch {
    return [];
  }
}

function write(list: LocalItinerary[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    return true;
  } catch {
    // Storage full or blocked (private mode): not kept.
    return false;
  }
}

/** Adds or replaces the itinerary under `key`; false when the browser would not store it. */
export function saveLocalItinerary(key: string, itinerary: Itinerary): boolean {
  const rest = loadLocalItineraries().filter((x) => x.key !== key);
  return write([{ key, name: itinerary.name, savedAt: new Date().toISOString(), itinerary }, ...rest]);
}

export function removeLocalItinerary(key: string): LocalItinerary[] {
  const next = loadLocalItineraries().filter((x) => x.key !== key);
  write(next);
  return next;
}
