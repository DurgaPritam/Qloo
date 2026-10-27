"use client";

import { useState } from "react";

import type { PlanSummary } from "@/lib/plan-summary";

import { PlanGrid } from "./showcase";
import { Segmented } from "./ui";

type Filter = "all" | "comedy" | "music" | "screen" | "sport" | "podcast";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "comedy", label: "Comedy" },
  { value: "music", label: "Music" },
  { value: "screen", label: "Film & TV" },
  { value: "sport", label: "Sport" },
  { value: "podcast", label: "Podcasts" },
];

/** From the format code chose: a person on a tour stop is a comedian, on a live show a performer. */
function group(p: PlanSummary): Filter {
  const f = p.format.toLowerCase();
  if (f.includes("fan fest")) return "sport";
  if (f.includes("screening") || p.category === "movie" || p.category === "tv_show") return "screen";
  if (p.category === "podcast") return "podcast";
  if (p.category === "person") return f.includes("tour stop") ? "comedy" : "music";
  return "music";
}

export function ExploreGrid({ plans }: { plans: readonly PlanSummary[] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const present = FILTERS.filter((f) => f.value === "all" || plans.some((p) => group(p) === f.value));
  const shown = filter === "all" ? plans : plans.filter((p) => group(p) === filter);
  return (
    <section className="flex flex-col gap-[18px]">
      <div className="overflow-x-auto">
        <Segmented label="Filter plans" options={present} value={filter} onChange={setFilter} />
      </div>
      <PlanGrid plans={shown} />
    </section>
  );
}
