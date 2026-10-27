"use client";

import type { BrandResult } from "@/lib/tools/brand";

import { categoryLabel, pct } from "../run/format";
import { Banner, Button, MonoLabel, OutlineChip, Panel, Sk, SourceBadge } from "../ui";
import { CityMap, CityTable } from "./city-table";
import { CallsUsed, ChoicePicker, RankRow, SampleBanner, ToolError, ToolForm, ToolIntro, useToolQuery } from "./tool-kit";

const EXAMPLES = [{ label: "Patagonia" }, { label: "Red Bull" }, { label: "Glossier" }, { label: "Liquid Death" }, { label: "Adidas" }];

export function BrandMatch() {
  const { value, state, submit, pick, retry } = useToolQuery<BrandResult>("/api/tools/brand", "brand", (brand, entityId) => ({
    brand,
    entityId,
  }));
  const r = state.data;
  return (
    <>
      <ToolIntro
        label="Brand match"
        title="Which talent should your brand back?"
        body="For brands and agencies. Type a brand and see the artists, people, podcasts and shows its customers over-index on, scored by the same engine as a takeover, plus the cities where those customers are."
      />
      <ToolForm
        initial={value}
        placeholder="Your brand, e.g. Patagonia"
        button="Find matches"
        examples={EXAMPLES}
        onSubmit={submit}
        busy={state.loading}
      />

      {state.error && <ToolError message={state.error} onRetry={retry} />}
      {state.loading && (
        <div className="grid gap-2 md:grid-cols-2">
          <Sk.block />
          <Sk.block />
        </div>
      )}
      {r?.status === "none" && (
        <Banner tone="neutral">Qloo has no brand called “{value}”. Check the spelling, or try one of the examples.</Banner>
      )}
      {r?.status === "choose" && r.choices && <ChoicePicker question={r.question ?? "Which one?"} choices={r.choices} onPick={pick} />}
      {r?.status === "done" && (
        <>
          <SampleBanner mock={r.mock} />
          <section className="flex flex-col gap-2">
            <MonoLabel>Brand</MonoLabel>
            <h2 className="t-display m-0 text-[clamp(28px,4vw,40px)] leading-[0.92]">{r.brand.name}</h2>
            <div className="flex flex-wrap gap-1.5">
              {r.brand.description && <OutlineChip>{r.brand.description.slice(0, 90)}</OutlineChip>}
              <OutlineChip>Market · {r.market.name}</OutlineChip>
            </div>
          </section>
          <div className="grid items-start gap-[18px] md:grid-cols-2">
            {r.lists.map((list) => (
              <Panel key={list.category} className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <MonoLabel className="text-acc-text">{list.label}</MonoLabel>
                  <SourceBadge>urn:entity:{list.category}</SourceBadge>
                </div>
                {list.error && (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="m-0 text-chip text-err">{list.error}</p>
                    <Button onClick={retry}>Try again</Button>
                  </div>
                )}
                {!list.error && list.picks.length === 0 && (
                  <p className="m-0 text-chip text-mute">{list.reason || "No matches in the popularity band."}</p>
                )}
                <div className="flex flex-col">
                  {list.picks.map((p, i) => (
                    <RankRow
                      key={p.entity.id}
                      rank={i + 1}
                      name={p.entity.name}
                      meta={`${categoryLabel(p.entity.category)} · score ${pct(p.score)} / 100 · ${p.confidence} confidence`}
                    />
                  ))}
                </div>
              </Panel>
            ))}
          </div>
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <MonoLabel className="text-acc-text">Where its customers are · {r.market.name}</MonoLabel>
              <SourceBadge>urn:heatmap</SourceBadge>
            </div>
            {r.citiesError && (
              <div className="flex flex-wrap items-center gap-2">
                <p className="m-0 text-chip text-err">{r.citiesError}</p>
                <Button onClick={retry}>Try again</Button>
              </div>
            )}
            {r.cities.length > 0 && (
              <div className="grid items-start gap-[18px] md:grid-cols-2">
                <CityMap cities={r.cities} label={`Map of the cities where ${r.brand.name} customers are strongest`} />
                <CityTable cities={r.cities} />
              </div>
            )}
            <p className="m-0 text-chip text-mute">
              Heat is 0–100 against the strongest city in {r.market.name}, for cities of 300,000 people or more, next to each
              city&apos;s rank by population.
            </p>
          </Panel>
          <p className="m-0 text-chip text-mute [text-wrap:pretty]">
            Matches are people {r.brand.name}&apos;s customers like, not existing deals. Fees and availability are to confirm with
            each partner.
          </p>
          <CallsUsed calls={r.calls} />
        </>
      )}
    </>
  );
}
