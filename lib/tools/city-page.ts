import "server-only";

import { cacheLife } from "next/cache";

import { withBudget } from "@/lib/agent/budget";
import { getQlooSource } from "@/lib/qloo/source";

import { BOOKING_KINDS, bookFor, type BookingResult } from "./venue";

/**
 * A city's taste page: every Venue booker list for it. Cached for a day, so search-engine visits
 * and repeat views make no new Qloo calls.
 */
export async function cityTaste(slug: string): Promise<BookingResult | null> {
  "use cache";
  cacheLife("days");
  const name = decodeURIComponent(slug).replace(/-/g, " ");
  const runId = `city-${slug}`;
  return bookFor(name, BOOKING_KINDS, withBudget(getQlooSource(), runId, BOOKING_KINDS.length), { runId });
}
