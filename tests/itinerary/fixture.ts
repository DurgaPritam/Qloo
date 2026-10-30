import { emptyStop, type Itinerary, type ItineraryStop, type StopCity } from "@/lib/itinerary/types";

/** Real coordinates; the legs below are what distanceKm gives for them. */
export const CITY: Record<string, StopCity> = {
  denver: { id: "5419384", name: "Denver", admin1: "Colorado", country: "US", lat: 39.7392, lon: -104.9847 },
  boulder: { id: "5574991", name: "Boulder", admin1: "Colorado", country: "US", lat: 40.015, lon: -105.2705 },
  chicago: { id: "4887398", name: "Chicago", admin1: "Illinois", country: "US", lat: 41.8781, lon: -87.6298 },
  milwaukee: { id: "5263045", name: "Milwaukee", admin1: "Wisconsin", country: "US", lat: 43.0389, lon: -87.9065 },
  austin: { id: "4671654", name: "Austin", admin1: "Texas", country: "US", lat: 30.2672, lon: -97.7431 },
};

export function stop(key: keyof typeof CITY, patch: Partial<ItineraryStop> = {}): ItineraryStop {
  return { ...emptyStop(CITY[key], `s-${key}`), role: "chosen", heat: { score: 0.8, cells: 12, against: "the hottest city in US" }, ...patch };
}

export function tour(stops: ItineraryStop[], patch: Partial<Itinerary> = {}): Itinerary {
  return { v: 1, name: "Test tour", fanbase: { id: "fb-1", name: "Phoebe Bridgers", category: "artist" }, startDate: "", kmPerTravelDay: 500, stops, mock: false, ...patch };
}
