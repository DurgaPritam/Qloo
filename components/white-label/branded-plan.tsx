"use client";

import type { CSSProperties } from "react";

import type { Plan } from "@/lib/agent/types";
import { ATTRIBUTION } from "@/lib/api/attribution";

import { BriefSection, CitySection, CrossoverSection, RoomSection } from "../run/sections";
import { viewFromPlan } from "../run/use-plan-stream";

/**
 * A shared plan under a workspace's own brand: its logo or name, its colours, no Takeover chrome.
 * Qloo's attribution and "to confirm with the promoter" always stay.
 */
export function BrandedPlan({ plan, brand }: { plan: Plan; brand: { name: string; logo: string | null; vars: Record<string, string> } | null }) {
  const view = viewFromPlan(plan);
  return (
    <div className="min-h-screen bg-bg font-body text-body text-ink" style={(brand?.vars ?? {}) as CSSProperties} data-white-label={brand ? "on" : "off"}>
      <div className="mx-auto flex max-w-[1040px] flex-col gap-[18px] px-panel py-6">
        <header className="flex items-center justify-between gap-3">
          {brand?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the workspace's own logo, a data URL
            <img src={brand.logo} alt={brand.name} className="max-h-10 max-w-[50%] object-contain" />
          ) : (
            <span className="t-display text-[22px] leading-none uppercase">{brand?.name ?? "Takeover"}</span>
          )}
        </header>
        <CrossoverSection view={view} />
        <CitySection view={view} />
        <RoomSection view={view} />
        <BriefSection view={view} />
        <footer className="border-t border-line pt-3 text-chip text-mute">
          <a href={ATTRIBUTION.url} target="_blank" rel="noopener noreferrer" data-attribution>
            {ATTRIBUTION.text}
          </a>
          . Capacity, dates and prices to confirm with the promoter.
        </footer>
      </div>
    </div>
  );
}
