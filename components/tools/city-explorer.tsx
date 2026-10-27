"use client";

import Link from "next/link";

import type { CityScore } from "@/lib/engine/types";
import type { CitiesResult } from "@/lib/tools/cities";

import { categoryLabel } from "../run/format";
import { planHref } from "../showcase";
import { Banner, Button, MonoLabel, OutlineChip, Panel, Sk, SourceBadge } from "../ui";
import { CityMap, CityTable } from "./city-table";
import { CallsUsed, ChoicePicker, SampleBanner, ToolError, ToolForm, ToolIntro, useToolQuery } from "./tool-kit";

const EXAMPLES = [
  { label: "Taylor Swift" },
  { label: "Arsenal" },
  { label: "Bad Bunny" },
  { label: "Call Her Daddy" },
  { label: "Dune: Part Two" },
];

export function CityExplorer() {
  const { value, state, submit, pick, retry } = useToolQuery<CitiesResult>("/api/tools/cities", "q", (fanbase, entityId) => ({
    fanbase,
    entityId,
  }));
  const r = state.data;
  const tops = r?.status === "done" ? r.markets.flatMap((m) => m.cities.slice(0, 3)) : [];
  return (
    <>
      <ToolIntro
        label="City explorer"
        title="Where is a fanbase strongest?"
        body="For tour planners, fan clubs and creators. Type a fanbase and see its strongest cities in its home country and three more markets, from Qloo heatmaps."
      />
      <ToolForm
        initial={value}
        placeholder="A fanbase, e.g. Taylor Swift"
        button="Find the cities"
        examples={EXAMPLES}
        onSubmit={submit}
        busy={state.loading}
      />

      {state.error && <ToolError message={state.error} onRetry={retry} />}
      {state.loading && <Sk.map />}
      {r?.status === "none" && (
        <Banner tone="neutral">We couldn&apos;t find a fanbase called “{value}”. Check the spelling, or try one of the examples.</Banner>
      )}
      {r?.status === "choose" && r.choices && <ChoicePicker question={r.question ?? "Which one?"} choices={r.choices} onPick={pick} />}
      {r?.status === "done" && (
        <>
          <SampleBanner mock={r.mock} />
          <section className="flex flex-col gap-2">
            <MonoLabel>Fanbase</MonoLabel>
            <h2 className="t-display m-0 text-[clamp(28px,4vw,40px)] leading-[0.92]">{r.fanbase.name}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <OutlineChip>{categoryLabel(r.fanbase.category)}</OutlineChip>
              <Link href={planHref(r.fanbase.name)} className="text-chip">
                Plan a takeover with {r.fanbase.name} →
              </Link>
            </div>
          </section>
          {tops.length > 0 && (
            <Panel>
              <MonoLabel className="text-acc-text">Top three cities in each market</MonoLabel>
              <CityMap cities={tops} label={`Map of ${r.fanbase.name}'s strongest cities across markets`} />
            </Panel>
          )}
          <div className="grid items-start gap-[18px] md:grid-cols-2">
            {r.markets.map((m) => (
              <MarketPanel key={m.market.code} name={m.market.name} home={m.home} cities={m.cities} error={m.error} onRetry={retry} />
            ))}
          </div>
          <p className="m-0 text-chip text-mute [text-wrap:pretty]">
            Heat is 0–100 against the strongest city in each country, so compare cities within a country, not across. Cities of
            150,000 people or more.
          </p>
          <CallsUsed calls={r.calls} />
        </>
      )}
    </>
  );
}

function MarketPanel({
  name,
  home,
  cities,
  error,
  onRetry,
}: {
  name: string;
  home: boolean;
  cities: CityScore[];
  error?: string;
  onRetry: () => void;
}) {
  return (
    <Panel className="min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonoLabel className="text-acc-text">
          {name}
          {home ? " · home market" : ""}
        </MonoLabel>
        <SourceBadge>urn:heatmap</SourceBadge>
      </div>
      {error && (
        <div className="flex flex-wrap items-center gap-2">
          <p className="m-0 text-chip text-err">{error}</p>
          <Button onClick={onRetry}>Try again</Button>
        </div>
      )}
      {!error && cities.length === 0 && <p className="m-0 text-chip text-mute">Qloo has no city-level heat for this fanbase here.</p>}
      {cities.length > 0 && <CityTable cities={cities} />}
    </Panel>
  );
}
