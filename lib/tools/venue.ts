import "server-only";

import { cityQuery } from "@/lib/agent/tools";
import { CITIES } from "@/lib/engine/data";
import { findCity, rankLocal, type LocalPick } from "@/lib/engine/local";
import type { Category, City } from "@/lib/engine/types";
import type { QlooSource, SourceMeta } from "@/lib/qloo/source";

export type BookingKind = "music" | "comedy" | "podcast";

const KINDS: Record<BookingKind, { label: string; category: Category; tags?: string[]; note: string }> = {
  music: { label: "Artists", category: "artist", note: "Music acts people here over-index on." },
  comedy: {
    label: "Stand-up comedians",
    category: "person",
    // Qloo's occupation tag; people without it (politicians, athletes) are left out.
    tags: ["urn:tag:occupation:person:stand_up_comedian"],
    note: "Comedians people here over-index on.",
  },
  podcast: { label: "Podcasts", category: "podcast", note: "Podcasts that could bring a live show here." },
};

export const BOOKING_KINDS = Object.keys(KINDS) as BookingKind[];

export interface BookingList {
  kind: BookingKind;
  label: string;
  note: string;
  picks: LocalPick[];
  dropped: number;
  error?: string;
}

export interface BookingResult {
  city: Pick<City, "id" | "name" | "admin1" | "country" | "population">;
  lists: BookingList[];
  calls: Array<Pick<SourceMeta, "endpoint" | "params" | "cached" | "ms">>;
  mock: boolean;
}

/** Who to book in a city: one Qloo call per kind, in parallel, ranked by lib/engine/local.ts. */
export async function bookFor(
  cityText: string,
  kinds: readonly BookingKind[],
  source: QlooSource,
  opts: { runId: string },
): Promise<BookingResult | null> {
  const city = findCity(cityText, CITIES);
  if (!city) return null;
  const where = cityQuery(city);
  const calls: BookingResult["calls"] = [];
  const lists = await Promise.all(
    kinds.map(async (kind): Promise<BookingList> => {
      const k = KINDS[kind];
      try {
        const res = await source.local(k.category, where, k.tags, opts);
        calls.push({ endpoint: res.meta.endpoint, params: res.meta.params, cached: res.meta.cached, ms: res.meta.ms });
        return { kind, label: k.label, note: k.note, ...rankLocal(res.data) };
      } catch (err) {
        console.warn(`[tools/venue] ${kind} failed:`, err instanceof Error ? `${err.name}: ${err.message.slice(0, 120)}` : "unknown");
        return { kind, label: k.label, note: k.note, picks: [], dropped: 0, error: "Qloo had no answer for this list; try again shortly." };
      }
    }),
  );
  const { id, name, admin1, country, population } = city;
  return { city: { id, name, admin1, country, population }, lists, calls, mock: source.mock };
}
