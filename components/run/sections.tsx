"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

import { ENGINE_CONFIG } from "@/lib/engine/config";

import { GeoMap, type GeoPoint } from "../geo-map";
import { downloadCsv, downloadDeck } from "./exports";

import {
  Banner,
  Button,
  Card,
  ConfirmPill,
  DataTable,
  EmailCard,
  EntityCard,
  Legend,
  MonoLabel,
  NoSourceBadge,
  Num,
  Panel,
  ScoreBar,
  Segmented,
  Sk,
  SourceBadge,
  cx,
  useCopy,
} from "../ui";
import { categoryLabel, mailto, paragraphs, pct, PROMOTER, two } from "./format";
import type { RunView } from "./use-plan-stream";

const DIM = "opacity-45";
const fade = "transition-opacity duration-[250ms]";

/* LLM-only view neutralises accent tokens locally so nothing reads as "sourced". */
const LLM_VARS = {
  "--acc": "var(--line)",
  "--acc-line": "var(--line)",
  "--acc-text": "var(--mute)",
  "--acc-soft": "var(--track)",
} as CSSProperties;

export interface LlmOnly {
  state: "idle" | "loading" | "ready" | "error";
  text?: string;
  message?: string;
}

/* ---------- 01 Crossover ---------- */
export function CrossoverSection({
  view,
  llm,
  onToggle,
  onUsePartner,
}: {
  view: RunView;
  llm?: LlmOnly & { on: boolean };
  onToggle?: (on: boolean) => void;
  onUsePartner?: (partnerId: string) => void;
}) {
  const { partners, fanbase, format } = view;
  const replanning = view.replanFrom === "partners";
  const chosen = partners?.picks.find((p) => p.pick.entity.id === partners.chosenId) ?? partners?.picks[0];
  const others = partners?.picks.filter((p) => p !== chosen) ?? [];
  const on = llm?.on ?? false;

  return (
    <Panel className="print:hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonoLabel>01 · Crossover partner</MonoLabel>
        {onToggle && (
          <Segmented<"qloo" | "llm">
            label="Compare with a plain chatbot"
            value={on ? "llm" : "qloo"}
            onChange={(v) => onToggle(v === "llm")}
            options={[
              { value: "qloo", label: "With Qloo" },
              { value: "llm", label: "LLM only" },
            ]}
          />
        )}
      </div>

      {on ? (
        <>
          <Banner tone="neutral">LLM only: what a plain chatbot guessed with no taste data. Nothing below is sourced or scored.</Banner>
          <div style={LLM_VARS} className="flex flex-col gap-[18px] rounded-md bg-bg p-[18px]">
            <div className="flex justify-between gap-3 font-mono text-label uppercase tracking-[0.08em] text-mute">
              <span>Chosen pair</span>
              <span>Unsourced guess</span>
            </div>
            {llm?.state === "loading" && (
              <div className="flex flex-col gap-2.5">
                <Sk.line />
                <Sk.line />
                <Sk.lineShort />
              </div>
            )}
            {llm?.state === "error" && <Banner tone="err">{llm.message ?? "The comparison is unavailable."}</Banner>}
            {llm?.state === "ready" && (
              <div className="flex flex-col gap-2.5 text-body [text-wrap:pretty]">
                {paragraphs(llm.text ?? "").map((p, i) => (
                  <p key={i} className="m-0 whitespace-pre-line">
                    {p}
                  </p>
                ))}
              </div>
            )}
            <div className="flex flex-col gap-2">
              <MonoLabel>Shared audience</MonoLabel>
              <ScoreBar value={0} label="Not measured" />
            </div>
            <div>
              <NoSourceBadge />
            </div>
          </div>
        </>
      ) : !partners || !fanbase ? (
        <div className="flex flex-col gap-2.5">
          <Sk.title />
          <Sk.line />
          <Sk.bar />
        </div>
      ) : (
        <>
          {partners.fallback && <Banner tone="warn">{partners.reason}</Banner>}
          {!chosen ? (
            <Banner tone="warn">No crossover partner qualified, so the plan stops here.</Banner>
          ) : (
            <div className={cx("flex flex-col gap-[18px]", fade, replanning && DIM)}>
              <div className="flex justify-between gap-3 font-mono text-label uppercase tracking-[0.08em] text-mute">
                <span>Chosen pair</span>
                <span className="tabular">{replanning ? "Replanning…" : `Score ${pct(chosen.pick.score)} / 100`}</span>
              </div>
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(260px,100%),1fr))]">
                <EntityCard
                  role="Fanbase"
                  size={32}
                  name={fanbase.name}
                  meta={`${categoryLabel(fanbase.category)} · popularity ${two(fanbase.popularity)}`}
                  badges={<SourceBadge />}
                />
                <EntityCard
                  role="Partner"
                  size={32}
                  name={chosen.pick.entity.name}
                  meta={`${categoryLabel(chosen.pick.entity.category)} · affinity ${two(chosen.pick.entity.affinity)} · popularity ${two(chosen.pick.entity.popularity)}`}
                  badges={
                    <>
                      <SourceBadge />
                      <ConfirmPill>To confirm · availability</ConfirmPill>
                    </>
                  }
                />
              </div>
              <div className="flex flex-col gap-2">
                <MonoLabel>Shared audience</MonoLabel>
                <ScoreBar value={pct(chosen.pick.entity.affinity)} label={`${pct(chosen.pick.entity.affinity)} / 100`} />
              </div>
              <div className="grid grid-cols-[minmax(0,8em)_minmax(0,1fr)] gap-x-4 gap-y-2.5 border-t border-line pt-3.5">
                <span className="pt-0.5 font-mono text-label uppercase tracking-[0.08em] text-mute">Format</span>
                <span className="font-medium">{format?.label ?? "—"}</span>
                <span className="pt-0.5 font-mono text-label uppercase tracking-[0.08em] text-mute">Why this pair</span>
                <div className="flex flex-col items-start gap-1.5">
                  <span className="[text-wrap:pretty]">{chosen.explanation}</span>
                  <SourceBadge>Qloo signal · {chosen.pick.confidence} confidence</SourceBadge>
                </div>
              </div>
            </div>
          )}
          {others.length > 0 && (
            <div className="flex flex-col gap-2">
              <MonoLabel className="pb-1">Also shortlisted</MonoLabel>
              <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))]">
                {others.map((o) => (
                  <Card key={o.pick.entity.id} inset className="gap-2.5">
                    <div className="flex flex-col gap-1">
                      <div className="font-body text-[18px] font-semibold leading-[1.2] [overflow-wrap:anywhere]">{o.pick.entity.name}</div>
                      <div className="text-chip text-mute">
                        {categoryLabel(o.pick.entity.category)} · affinity {two(o.pick.entity.affinity)}
                      </div>
                    </div>
                    <ScoreBar value={pct(o.pick.score)} fill="mute" />
                    <div className="flex flex-wrap items-center gap-2 pt-0.5">
                      <SourceBadge />
                      <div className="flex-1" />
                      {onUsePartner && (
                        <Button variant="pick" disabled={view.phase === "running"} onClick={() => onUsePartner(o.pick.entity.id)}>
                          Use this partner
                        </Button>
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}
          {partners.picks.length > 1 && (
            <div className="flex flex-col gap-2">
              <MonoLabel>Compare the shortlist</MonoLabel>
              <DataTable
                columns={["Partner", "Affinity", "Pop.", "Score"]}
                template="minmax(0,1fr) 4.8em 3.6em 3.6em"
                rows={partners.picks.map(({ pick }) => {
                  const isChosen = pick.entity.id === chosen?.pick.entity.id;
                  return [
                    <span key="n" className="flex min-w-0 flex-col">
                      <span className={cx("[overflow-wrap:anywhere]", isChosen && "font-medium")}>{pick.entity.name}</span>
                      <span className="text-mute">{categoryLabel(pick.entity.category)}</span>
                    </span>,
                    <Num key="a">{two(pick.entity.affinity)}</Num>,
                    <Num key="p" mute>
                      {two(pick.entity.popularity)}
                    </Num>,
                    <Num key="s" top={isChosen}>
                      {pct(pick.score)}
                    </Num>,
                  ];
                })}
              />
              <p className="m-0 text-chip text-mute [text-wrap:pretty]">
                Score = affinity relative to its category (0 at the median, 1 at the best) × a gentle discount for
                mainstream reach (Pop.). Mega-stars above 0.999 and names below 0.5 are left out.{" "}
                {partners.reason}
              </p>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/* ---------- 02 City ---------- */
function toPoint(p: { id: string; name: string; lat: number; lon: number; combined: number }, chosenId: string, label?: string): GeoPoint {
  const score = pct(p.combined);
  return {
    id: p.id,
    name: label ?? p.name,
    lat: p.lat,
    lon: p.lon,
    value: String(score),
    size: Math.max(7, Math.round(10 + (score - 50) * 0.55)),
    tone: p.id === chosenId ? "acc" : score >= 75 ? "mute" : "line",
    ring: p.id === chosenId,
  };
}

export function CitySection({ view, onUseCity, extra }: { view: RunView; onUseCity?: (cityId: string) => void; extra?: ReactNode }) {
  const { city, fanbase, partners } = view;
  const [mode, setMode] = useState<"cities" | "tour">("cities");
  const dim = view.replanFrom === "partners";
  const chosen = city?.chosen?.pick;
  const partnerName = partners?.picks.find((p) => p.pick.entity.id === partners.chosenId)?.pick.entity.name ?? "the partner";
  const tour = city?.tour;
  const hasTour = Boolean(tour && tour.stops.length > 1);
  const showTour = mode === "tour" && hasTour;

  const points =
    city && chosen
      ? showTour
        ? tour!.stops.map((s, i) => toPoint({ ...s.city, combined: s.combined }, chosen.city.id, `${i + 1} · ${s.city.name}`))
        : city.map.slice(0, city.table.length).map((p) => toPoint(p, chosen.city.id))
      : [];

  return (
    <Panel className={cx("gap-[18px] print:hidden", fade, dim && DIM)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <MonoLabel>02 · City</MonoLabel>
        <SourceBadge>Qloo signal · urn:heatmap</SourceBadge>
      </div>
      {!city ? (
        <>
          <Sk.map />
          <div className="flex gap-3">
            <Sk.legend />
            <Sk.legend />
            <Sk.legend />
          </div>
        </>
      ) : (
        <>
          {city.level === "region" && (
            <div className="flex flex-wrap items-center gap-2">
              <Banner tone="warn">
                Thin data for {fanbase?.name ?? "this fanbase"}: too few city-level signals to rank cities. Showing regional overlap
                instead.
              </Banner>
              <ConfirmPill>Fallback · wider region</ConfirmPill>
            </div>
          )}
          {city.basis === "fanbase" && (
            <div className="flex flex-wrap items-center gap-2">
              <Banner tone="warn">{city.reason}</Banner>
              <ConfirmPill>Fallback · fanbase only</ConfirmPill>
            </div>
          )}
          {!chosen ? (
            <Banner tone="warn">{city.reason} No city has heat for both audiences, so the plan stops here.</Banner>
          ) : (
            <>
              <div className="flex flex-wrap items-end justify-between gap-3">
                <h2 className="t-display m-0 text-[clamp(28px,4vw,40px)] leading-[0.92]">{chosen.city.name}</h2>
                {hasTour && (
                  <Segmented<"cities" | "tour">
                    label="Map view"
                    value={showTour ? "tour" : "cities"}
                    onChange={setMode}
                    options={[
                      { value: "cities", label: "Top cities" },
                      { value: "tour", label: "Tour route" },
                    ]}
                  />
                )}
              </div>
              <div className="grid items-start gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr))]">
                <div className="flex flex-col gap-3">
                  <GeoMap
                    points={points}
                    route={showTour ? tour!.stops.map((s) => s.city) : undefined}
                    label={
                      showTour
                        ? `Map of a ${tour!.stops.length}-stop tour route`
                        : `Map of the top cities, ${chosen.city.name} highlighted`
                    }
                  />
                  <Legend
                    items={
                      showTour
                        ? [
                            { tone: "acc", label: "Chosen city" },
                            { tone: "mute", label: "Tour stop, score 75+" },
                            { tone: "line", label: "Tour stop, below 75" },
                          ]
                        : [
                            { tone: "acc", label: "Chosen city" },
                            { tone: "mute", label: "Score 75+" },
                            { tone: "line", label: "Below 75" },
                          ]
                    }
                  />
                  <p className="m-0 text-chip text-mute [text-wrap:pretty]">
                    Combined score, 0–100: how strongly {fanbase?.name} fans and {partnerName} fans show up together in a city. Each
                    audience is scaled so its strongest city is 100, then the two are combined, so a city only scores high when both
                    are strong. Dot size follows the score.
                  </p>
                </div>
                {showTour ? (
                  <div className="flex flex-col gap-2">
                    <MonoLabel>
                      Tour route · {tour!.stops.length} stops · {tour!.totalKm.toLocaleString("en-GB")} km
                    </MonoLabel>
                    {tour!.fallback && <Banner tone="warn">{tour!.reason}</Banner>}
                    <DataTable
                      columns={["Stop", "City", "Score", "Leg"]}
                      template="3em minmax(0,1fr) 4.5em 6.5em"
                      rows={tour!.stops.map((s, i) => [
                        <Num key="n" mute>
                          {String(i + 1).padStart(2, "0")}
                        </Num>,
                        <span key="c">
                          {s.city.name}
                          <span className="text-mute">, {s.city.admin1 || s.city.country}</span>
                        </span>,
                        <Num key="s" top={s.city.id === chosen.city.id}>
                          {pct(s.combined)}
                        </Num>,
                        <Num key="l" mute>
                          {i === 0 ? "start" : `${s.legKm.toLocaleString("en-GB")} km`}
                        </Num>,
                      ])}
                    />
                    <p className="m-0 text-chip text-mute [text-wrap:pretty]">
                      The best-scoring cities at least {ENGINE_CONFIG.tour.minSpacingKm} km apart, ordered by code to keep total travel shortest. Distances are
                      straight-line; dates and routing are {PROMOTER}.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col">
                    {city.table.map(({ pick: c }, i) => (
                      <div
                        key={c.city.id}
                        className="grid grid-cols-[2em_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1.5 border-b border-line py-2.5"
                      >
                        <span className="tabular font-mono text-[11px] text-mute">{String(i + 1).padStart(2, "0")}</span>
                        <div className="flex min-w-0 flex-col gap-1.5">
                          <span className="font-medium">
                            {c.city.name}
                            <span className="text-chip text-mute">, {c.city.admin1 || c.city.country}</span>
                          </span>
                          <ScoreBar value={pct(c.combined)} fill={c.city.id === chosen.city.id ? "acc" : "mute"} className="gap-2" />
                        </div>
                        {c.city.id === chosen.city.id ? (
                          <span className="px-1.5 font-mono text-label uppercase tracking-[0.06em] text-acc-text">Chosen</span>
                        ) : onUseCity ? (
                          <Button variant="pick" disabled={view.phase === "running"} onClick={() => onUseCity(c.city.id)}>
                            Use this city
                          </Button>
                        ) : (
                          <span />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <MonoLabel>With Qloo rank vs population rank</MonoLabel>
                  {view.plan && <Button onClick={() => downloadCsv(view.plan!)}>Download CSV</Button>}
                </div>
                <div className="max-w-[520px]">
                  <DataTable
                    columns={["City", "With Qloo", "Population"]}
                    template="minmax(0,1fr) 7em 7em"
                    rows={city.table.map(({ pick: c }) => [
                      <span key="n">{c.city.name}</span>,
                      <Num key="q" top={c.rank === 1}>
                        #{c.rank}
                      </Num>,
                      <Num key="p" mute>
                        #{c.populationRank}
                      </Num>,
                    ])}
                  />
                </div>
                {city.populationPick && city.populationPick.city.id !== chosen.city.id && (
                  <p className="m-0 text-chip text-mute">
                    Population alone would pick {city.populationPick.city.name} (#{city.populationPick.rank} with Qloo).
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}
      {extra}
    </Panel>
  );
}

/* ---------- 03 Room & sponsors ---------- */
const ListRow = ({ name, meta }: { name: string; meta: string }) => (
  <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line py-2.5">
    <div className="flex min-w-40 flex-1 flex-col">
      <span className="font-medium">{name}</span>
      <span className="text-chip text-mute">{meta}</span>
    </div>
    <SourceBadge />
  </div>
);

export function RoomSection({ view }: { view: RunView }) {
  const { room } = view;
  const step = view.steps.room;
  const dim = view.replanFrom !== null;
  const venue = room?.venue?.pick;

  return (
    <Panel className={cx("gap-[18px] print:hidden", fade, dim && DIM)}>
      <MonoLabel>03 · Room &amp; sponsors</MonoLabel>
      {step.status === "error" && <Banner tone="err">{step.errorText} Retry the step from the log to continue.</Banner>}
      {!room ? (
        step.status !== "error" && (
          <div className="flex flex-col gap-2.5">
            <Sk.card />
            <Sk.row />
            <Sk.row />
            <Sk.row />
          </div>
        )
      ) : (
        <>
          {room.movedFrom && (
            <Banner tone="warn">
              {room.movedFrom.cityName} has no tagged venues for this audience. Using {room.cityName}, the nearest city with a match,{" "}
              {room.movedFrom.distanceKm} km away.
            </Banner>
          )}
          {room.fallback && !room.movedFrom && <Banner tone="warn">{room.reason}</Banner>}
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
            {venue ? (
              <EntityCard
                role="Venue"
                name={venue.place.name}
                meta={[room.cityName, ...venue.evidence.matchedTags].join(" · ")}
                badges={
                  <>
                    {room.movedFrom && <ConfirmPill>Nearest city · not {room.movedFrom.cityName}</ConfirmPill>}
                    <SourceBadge />
                    <ConfirmPill>Capacity · {PROMOTER}</ConfirmPill>
                    <ConfirmPill>Dates · {PROMOTER}</ConfirmPill>
                    <ConfirmPill>Price · {PROMOTER}</ConfirmPill>
                  </>
                }
              />
            ) : (
              <EntityCard role="Venue" name="No venue found" meta={`No place in ${room.cityName} cleared the affinity floor.`} />
            )}
            {room.opener && (
              <EntityCard
                role="Local opener or host"
                name={room.opener.pick.entity.name}
                meta={`${categoryLabel(room.opener.pick.entity.category)} · affinity ${two(room.opener.pick.entity.affinity)}`}
                badges={
                  <>
                    <SourceBadge />
                    <ConfirmPill>Dates · {PROMOTER}</ConfirmPill>
                  </>
                }
              />
            )}
          </div>
          <div className="grid gap-[18px] [grid-template-columns:repeat(auto-fit,minmax(min(300px,100%),1fr))]">
            <div className="flex flex-col gap-2">
              <MonoLabel>After-show spots</MonoLabel>
              {room.spots.length === 0 && <span className="text-chip text-mute">No spots cleared the affinity floor.</span>}
              {room.spots.map(({ pick }) => (
                <ListRow
                  key={pick.place.id}
                  name={pick.place.name}
                  meta={[...pick.evidence.matchedTags, `affinity ${two(pick.evidence.affinity)}`].join(" · ")}
                />
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <MonoLabel>Sponsors</MonoLabel>
              {room.sponsors.length === 0 && <span className="text-chip text-mute">No sponsor passed the bias guard.</span>}
              {room.sponsors.map(({ pick }) => (
                <ListRow
                  key={pick.brand.id}
                  name={pick.brand.name}
                  meta={`affinity ${two(pick.evidence.affinity)} · popularity ${two(pick.evidence.popularity)} · ${pick.confidence} confidence`}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

/* ---------- 04 Brief (the only thing that prints) ---------- */
export function BriefSection({ view, shareUrl }: { view: RunView; shareUrl?: string }) {
  const { brief } = view;
  const [paper, setPaper] = useState<"letter" | "a4">("letter");
  const { copied, copy } = useCopy();
  const dim = view.replanFrom !== null;

  if (!brief) {
    return (
      <Panel className="gap-2.5 print:hidden">
        <MonoLabel>04 · The brief</MonoLabel>
        <Sk.title />
        <Sk.line />
        <Sk.line />
        <Sk.lineShort />
      </Panel>
    );
  }

  const rows = [
    { k: "Format", v: brief.format, why: brief.headline, src: "Format rule in code, from the fanbase's Qloo type" },
    // Sponsors keep only their reason; their numbers are on the room section and in the source.
    ...brief.items.map((i) => ({
      k: i.label,
      v: i.name,
      why: i.label === "Sponsors" ? i.reason : [i.reason, i.evidence].filter(Boolean).join(" "),
      src: i.source,
    })),
  ];
  const text =
    `Takeover brief · ${brief.title}\n\n${brief.headline}\n\n` +
    rows.map((b) => `${b.k}: ${b.v}\n${b.why}\nSource: ${b.src}`).join("\n\n") +
    `\n\nCapacity, dates and price ${PROMOTER}.`;
  const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

  return (
    <section id="brief" className={cx("flex flex-col gap-3", fade, dim && DIM)}>
      <div className="flex flex-wrap items-center gap-2 print:hidden">
        <MonoLabel className="mr-auto">04 · The brief</MonoLabel>
        <Segmented mono label="Paper size" value={paper} onChange={setPaper} options={[{ value: "letter", label: "Letter" }, { value: "a4", label: "A4" }]} />
        <Button variant="primary" onClick={() => window.print()}>
          Download PDF
        </Button>
        {view.plan && <DeckButton plan={view.plan} />}
        <Button onClick={() => copy("brief", text)}>{copied === "brief" ? "Copied" : "Copy as text"}</Button>
        <Button onClick={() => copy("link", shareUrl ?? `${location.href.split("#")[0]}#brief`)}>
          {copied === "link" ? "Copied" : "Copy link"}
        </Button>
      </div>
      <article
        className={cx(
          "box-border flex w-full max-w-[680px] flex-col gap-[18px] self-center rounded-badge bg-paper p-[clamp(22px,6%,48px)] text-paper-ink",
          paper === "a4" ? "aspect-[210/297]" : "aspect-[8.5/11]",
          // Grow past the paper ratio rather than overflow it.
          "min-h-fit",
          "print:aspect-auto print:max-w-none print:border-0 print:p-0 print:shadow-none",
        )}
      >
        <div className="flex justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">
          <span>Takeover brief{brief.templated ? " · template wording" : ""}</span>
          <span>{date}</span>
        </div>
        <div className="t-display text-[clamp(22px,4vw,34px)] leading-[0.95] [text-wrap:balance]">{brief.title}</div>
        <div className="flex flex-col">
          {rows.map((b) => (
            <div key={b.k} className="grid grid-cols-[minmax(0,6.5em)_minmax(0,1fr)] gap-x-3.5 gap-y-1 border-t border-paper-line py-2.5">
              <span className="pt-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-paper-mute">{b.k}</span>
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[13px] font-medium">{b.v}</span>
                <span className="text-[11.5px] text-n-800 [text-wrap:pretty]">{b.why}</span>
                <span className="font-mono text-[10px] text-paper-mute [overflow-wrap:anywhere]">◆ {b.src}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-auto border-t border-paper-line pt-2.5 text-[10.5px] text-paper-mute">
          Capacity, dates and price {PROMOTER}. Every pick is backed by Qloo taste data.
        </div>
      </article>
    </section>
  );
}

function DeckButton({ plan }: { plan: NonNullable<RunView["plan"]> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadDeck(plan);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Building deck…" : "Download deck"}
    </Button>
  );
}

/* ---------- 05 Outreach ---------- */
export function OutreachSection({ view, action }: { view: RunView; action?: ReactNode }) {
  const { outreach } = view;
  const { copied, copy } = useCopy();
  const dim = view.replanFrom !== null;
  return (
    <section className={cx("flex flex-col gap-3 print:hidden", fade, dim && DIM)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <MonoLabel>05 · Outreach</MonoLabel>
        <div className="text-chip text-mute">Drafts only. Takeover never sends email.</div>
      </div>
      {outreach && action}
      {!outreach ? (
        <Panel className="gap-2.5">
          <Sk.lineShort />
          <Sk.lineShort />
          <Sk.block />
        </Panel>
      ) : (
        <div className="grid items-start gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr))]">
          {outreach.map((m) => (
            <EmailCard
              key={m.to}
              to={m.recipient}
              subject={m.subject}
              body={paragraphs(m.body)}
              copied={copied === m.to}
              onCopy={() => copy(m.to, `To: ${m.recipient}\nSubject: ${m.subject}\n\n${m.body}`)}
              mailto={mailto(m.subject, m.body)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
