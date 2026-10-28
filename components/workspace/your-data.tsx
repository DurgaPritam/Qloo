"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { combineCityScores, DEFAULT_USER_WEIGHT, type CombinedCity } from "@/lib/engine/combine";
import { fileKind, MAX_FILE_BYTES, readTable, type Table } from "@/lib/data/table";
import { METRIC_LABEL, type CityOption, type ColumnRole, type DatasetView, type MetricKind, type RankingData, type ReviewItem } from "@/lib/data/types";

import { FIELD } from "../account/fields";
import { Calls } from "./calls";
import { GeoMap, type GeoPoint } from "../geo-map";
import { pct } from "../run/format";
import { Banner, Button, CombinedBadge, cx, MonoLabel, Num, OutlineChip, Panel, Segmented, SourceBadge, YourDataBadge } from "../ui";

/* ---------- Steps ---------- */

const STEPS = ["Upload", "Map columns", "Ranking"] as const;

/** The design's three-step bar: filled up to the current step. */
export function DataSteps({ at }: { at: 1 | 2 | 3 }) {
  return (
    <ol className="m-0 grid list-none grid-cols-3 gap-1.5 p-0" aria-label="Steps">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-col gap-1.5" aria-current={i + 1 === at ? "step" : undefined}>
          <span className={cx("h-1 rounded-pill", i < at ? "bg-acc-line" : "bg-track")} />
          <span className={cx("font-mono text-label uppercase tracking-[0.06em]", i + 1 === at ? "text-ink" : "text-mute")}>
            {String(i + 1).padStart(2, "0")} · {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

/* ---------- Upload and mapping ---------- */

type RoleValue = "city" | "country" | MetricKind | "ignore";
const ROLE_OPTIONS: { value: RoleValue; label: string }[] = [
  { value: "city", label: "City" },
  { value: "country", label: "Country" },
  ...(Object.keys(METRIC_LABEL) as MetricKind[]).map((k) => ({ value: k, label: METRIC_LABEL[k] })),
  { value: "ignore", label: "Ignore" },
];

const toRole = (v: RoleValue): ColumnRole => (v === "city" || v === "country" || v === "ignore" ? { role: v } : { role: "metric", kind: v });

/** A first guess from the header; the person changes it in the mapping step. */
export function guessRole(column: string, samples: readonly string[]): RoleValue {
  const c = column.toLowerCase();
  if (/(^|_|\s)(city|metro|market|town)/.test(c)) return "city";
  if (/country|nation/.test(c)) return "country";
  if (/tix|ticket|sold|attendance/.test(c)) return "tickets";
  if (/stream|plays|listens/.test(c)) return "streams";
  if (/signup|sign_up|subscriber|email|lead/.test(c)) return "signups";
  if (/revenue|gross|sales|income/.test(c)) return "revenue";
  if (/date|time|price|avg|id$/.test(c)) return "ignore";
  return samples.length && samples.every((s) => /^[\d,.\s$€£]+$/.test(s) && s.trim()) ? "other" : "ignore";
}

export function DataUpload() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [table, setTable] = useState<Table | null>(null);
  const [roles, setRoles] = useState<Record<string, RoleValue>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const read = async (f: File | undefined) => {
    setError(null);
    setTable(null);
    if (!f) return;
    if (!fileKind(f.name)) return setError("Upload a .csv or .xlsx file.");
    if (f.size > MAX_FILE_BYTES) return setError("The file is over 5 MB.");
    try {
      const t = readTable(new Uint8Array(await f.arrayBuffer()), f.name);
      setFile(f);
      setTable(t);
      setRoles(Object.fromEntries(t.columns.map((c, i) => [c, guessRole(c, t.rows.slice(0, 5).map((r) => r[i]))])));
    } catch (err) {
      setError(err instanceof Error ? err.message : "That file could not be read.");
    }
  };

  const values = Object.values(roles);
  const mapError =
    values.filter((v) => v === "city").length !== 1
      ? "Map one column to City."
      : values.filter((v) => v === "country").length > 1
        ? "Map at most one column to Country."
        : !values.some((v) => v !== "city" && v !== "country" && v !== "ignore")
          ? "Map at least one column to a metric."
          : null;

  const upload = async () => {
    if (!file || !table || mapError) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("file", file);
    form.set("mapping", JSON.stringify(Object.fromEntries(Object.entries(roles).map(([c, v]) => [c, toRole(v)]))));
    const res = await fetch("/api/workspace/datasets", { method: "POST", body: form }).catch(() => null);
    const body = ((await res?.json().catch(() => null)) ?? {}) as { id?: string; error?: string };
    setBusy(false);
    if (res?.ok && body.id) router.push(`/workspace/data/${body.id}`);
    else setError(body.error ?? "The upload didn't work. Try again.");
  };

  return (
    <>
      <DataSteps at={table ? 2 : 1} />
      {error && <Banner tone="err">{error}</Banner>}
      {!table ? (
        <Panel>
          <label className="relative flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border-th border-dashed border-line bg-bg px-4 py-10 text-center">
            <input type="file" accept=".csv,.xlsx,text/csv" className="absolute h-px w-px opacity-0" aria-label="Data file" onChange={(e) => void read(e.target.files?.[0])} />
            <span className="font-semibold">Drop a CSV or XLSX, or choose a file</span>
            <span className="text-chip text-mute">Ticket sales, streams, signups or revenue by city. One row per city or per sale.</span>
          </label>
          <span className="text-chip text-mute">Up to 5 MB and 5,000 rows. The file is stored privately in this workspace and never sent to the AI model.</span>
        </Panel>
      ) : (
        <Panel>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <MonoLabel>Map columns · {file?.name}</MonoLabel>
            <YourDataBadge />
          </div>
          <div className="flex flex-col">
            {table.columns.map((c, i) => (
              <div key={c} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3 border-b border-line py-2.5">
                <span className="flex min-w-0 flex-col">
                  <span className="font-mono text-chip [overflow-wrap:anywhere]">{c}</span>
                  <span className="truncate text-chip text-mute">e.g. {table.rows.find((r) => r[i])?.[i] ?? "—"}</span>
                </span>
                <select
                  aria-label={`Map ${c}`}
                  value={roles[c]}
                  onChange={(e) => setRoles({ ...roles, [c]: e.target.value as RoleValue })}
                  className={cx(FIELD, "w-full cursor-pointer")}
                >
                  {ROLE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {mapError && <span className="text-chip text-warn">{mapError}</span>}
          <MonoLabel>Preview · first 5 rows</MonoLabel>
          <div className="-mx-1 overflow-x-auto px-1">
            <div className="flex flex-col text-chip" role="table" aria-label="Preview" style={{ minWidth: `${table.columns.length * 9}em` }}>
              <div role="row" className="grid gap-2.5 border-b border-line pb-1.5 font-mono text-label uppercase tracking-[0.06em] text-mute" style={{ gridTemplateColumns: `repeat(${table.columns.length}, minmax(0,1fr))` }}>
                {table.columns.map((c) => (
                  <span role="columnheader" key={c} className="truncate">
                    {c} → {ROLE_OPTIONS.find((o) => o.value === roles[c])?.label}
                  </span>
                ))}
              </div>
              {table.rows.slice(0, 5).map((r, i) => (
                <div role="row" key={i} className="grid gap-2.5 border-b border-line py-2 font-mono" style={{ gridTemplateColumns: `repeat(${table.columns.length}, minmax(0,1fr))` }}>
                  {r.map((v, j) => (
                    <span role="cell" key={j} className={cx("truncate", roles[table.columns[j]] === "ignore" && "text-mute")}>
                      {v}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <span className="text-chip text-mute">
            {table.rows.length.toLocaleString("en-GB")} rows{table.truncated ? `; ${table.truncated} past the first 5,000 are not read` : ""}. City names are matched to GeoNames
            next; any that are unclear come back for you to check.
          </span>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" loading={busy} disabled={Boolean(mapError)} onClick={() => void upload()} className="min-h-[44px] px-4">
              Upload and match cities
            </Button>
            <Button onClick={() => setTable(null)} className="min-h-[44px] px-4">
              Choose another file
            </Button>
          </div>
        </Panel>
      )}
    </>
  );
}

/* ---------- Ranking: Qloo signal, your data, combined ---------- */

type Lens = "qloo" | "yours" | "combined";

/**
 * The three labelled columns and the map, from combineCityScores (engine code, run here as the
 * weight changes). Nothing is blended without its parts beside it.
 */
export function CityRanking({ ranking, title, chosenCityId, onUseCity }: { ranking: RankingData; title: string; chosenCityId?: string; onUseCity?: (cityId: string) => void }) {
  const [weight, setWeight] = useState(DEFAULT_USER_WEIGHT);
  const [metric, setMetric] = useState(ranking.metrics[0]?.key ?? "");
  const [show, setShow] = useState<"table" | "map">("table");
  const [lens, setLens] = useState<Lens>("combined");
  const [traced, setTraced] = useState<string | null>(null);
  const label = ranking.metrics.find((m) => m.key === metric)?.label ?? "Your metric";
  const info = useMemo(() => new Map(ranking.cities.map((c) => [c.id, c])), [ranking.cities]);
  const rows = useMemo(
    () => combineCityScores(ranking.qloo ?? [], ranking.totals[metric] ?? [], weight).filter((r) => info.has(r.cityId)),
    [ranking, metric, weight, info],
  );
  const shown = rows.slice(0, 25);
  // One template for every row, so the columns line up whether a row has a button or not.
  const grid = onUseCity || chosenCityId ? "grid-cols-[2.5em_minmax(0,1fr)_6em_6em_6em_8.5em]" : "grid-cols-[2.5em_minmax(0,1fr)_6em_6em_6em]";
  const value = (r: (typeof rows)[number], l: Lens) => (l === "qloo" ? r.qloo : l === "yours" ? r.yours : r.combined);
  const w = pct(weight);
  const points: GeoPoint[] = rows
    .filter((r) => value(r, lens) !== null)
    .sort((a, b) => (value(b, lens) ?? 0) - (value(a, lens) ?? 0))
    .slice(0, 10)
    .map((r, i) => {
      const c = info.get(r.cityId)!;
      const v = pct(value(r, lens) ?? 0);
      return { id: c.id, name: c.name, lat: c.lat, lon: c.lon, value: String(v), size: Math.max(8, Math.round(8 + v * 0.14)), tone: i === 0 ? "acc" : "mute", ring: i === 0 };
    });

  return (
    <section className="flex flex-col gap-3" aria-label="City ranking">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <MonoLabel>{title}</MonoLabel>
        {ranking.metrics.length > 1 && (
          <select aria-label="Metric" value={metric} onChange={(e) => setMetric(e.target.value)} className={cx(FIELD, "cursor-pointer py-1 text-chip")}>
            {ranking.metrics.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="grid gap-2 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
        <div className="flex flex-col items-start gap-1.5 rounded-md bg-bg p-3">
          <SourceBadge />
          <span className="text-chip text-mute">{ranking.qloo ? `${ranking.qlooLabel}, 0–100 against the hottest city.` : "Attach a fanbase to compare with Qloo."}</span>
        </div>
        <div className="flex flex-col items-start gap-1.5 rounded-md bg-bg p-3">
          <YourDataBadge />
          <span className="text-chip text-mute">{label}, scaled 0–100 against your best city. Not checked by Takeover.</span>
        </div>
        <div className="flex flex-col items-start gap-1.5 rounded-md bg-bg p-3">
          <CombinedBadge />
          <span className="text-chip text-mute">Weighted blend of the two. Set the weight below.</span>
        </div>
      </div>
      <label className="flex flex-wrap items-center gap-3">
        <span className="text-body">Weight on your data</span>
        <input
          type="range"
          min={0}
          max={100}
          step={10}
          value={w}
          onChange={(e) => setWeight(Number(e.target.value) / 100)}
          aria-label="Weight on your data"
          className="min-w-[160px] flex-1 accent-acc-line"
        />
        <span className="tabular font-mono text-chip">
          {w}% yours · {100 - w}% Qloo
        </span>
      </label>
      <p className="m-0 font-mono text-chip text-mute [overflow-wrap:anywhere]" data-formula>
        Combined = {(1 - weight).toFixed(1)} × Qloo signal + {weight.toFixed(1)} × Your data. Your data = city {label.toLowerCase()} ÷ your best city&apos;s.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Show" options={[{ value: "table", label: "Table" }, { value: "map", label: "Map" }]} value={show} onChange={setShow} />
        {show === "map" && (
          <Segmented
            label="Map shows"
            mono
            options={[
              { value: "qloo", label: "◆ Qloo signal" },
              { value: "yours", label: "■ Your data" },
              { value: "combined", label: "◆■ Combined" },
            ]}
            value={lens}
            onChange={setLens}
          />
        )}
      </div>
      {show === "map" ? (
        points.length ? (
          <GeoMap points={points} label={`Top cities by ${lens === "qloo" ? "Qloo signal" : lens === "yours" ? "your data" : "combined score"}`} />
        ) : (
          <Banner tone="neutral">No city has a value for this view yet.</Banner>
        )
      ) : (
        <div className="-mx-1 overflow-x-auto px-1">
          <div className="flex min-w-[520px] flex-col text-body" role="table" aria-label="Cities: Qloo signal, your data, combined">
            <div role="row" className={cx("grid gap-3 border-b border-line pb-2", grid, "font-mono text-label uppercase tracking-[0.06em] text-mute")}>
              <span role="columnheader">#</span>
              <span role="columnheader">City</span>
              <span role="columnheader" className="text-right">
                ◆ Qloo signal
              </span>
              <span role="columnheader" className="text-right">
                ■ Your data
              </span>
              <span role="columnheader" className="text-right">
                ◆■ Combined
              </span>
              {(onUseCity || chosenCityId) && <span />}
            </div>
            {shown.map((r) => {
              const c = info.get(r.cityId)!;
              return (
                <div role="row" key={r.cityId} className={cx("grid items-center gap-3 border-b border-line py-2.5", grid)} data-city={c.name}>
                  <span role="cell" className="tabular font-mono text-label text-mute">
                    {String(r.rank).padStart(2, "0")}
                  </span>
                  <span role="cell" className="flex min-w-0 flex-col items-start [overflow-wrap:anywhere]">
                    <span>
                      {c.name}
                      <span className="text-chip text-mute">, {c.admin1 || c.country}</span>
                    </span>
                    <button
                      type="button"
                      aria-expanded={traced === r.cityId}
                      onClick={() => setTraced(traced === r.cityId ? null : r.cityId)}
                      className="cursor-pointer border-0 bg-transparent p-0 font-body text-chip text-acc-text"
                    >
                      {traced === r.cityId ? "Hide sources" : "Where these numbers come from"}
                    </button>
                  </span>
                  <span role="cell" className="text-right">
                    <Num>{r.qloo === null ? "—" : pct(r.qloo)}</Num>
                  </span>
                  <span role="cell" className="flex flex-col items-end">
                    <Num>{r.yours === null ? "—" : pct(r.yours)}</Num>
                    {r.raw !== null && <span className="tabular font-mono text-label text-mute">{r.raw.toLocaleString("en-GB")}</span>}
                  </span>
                  <span role="cell" className="text-right">
                    <Num top={r.rank === 1}>{pct(r.combined)}</Num>
                  </span>
                  {(onUseCity || chosenCityId) && (
                    <span role="cell" className="text-right">
                      {chosenCityId === r.cityId ? (
                        <span className="font-mono text-label uppercase tracking-[0.06em] text-acc-text">Chosen</span>
                      ) : onUseCity && r.qloo !== null ? (
                        <Button variant="pick" onClick={() => onUseCity(r.cityId)}>
                          Use this city
                        </Button>
                      ) : null}
                    </span>
                  )}
                  {traced === r.cityId && (
                    <div role="cell" className="col-span-full">
                      <Trace row={r} name={c.name} ranking={ranking} metric={metric} metricLabel={label} info={info} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      <span className="text-chip text-mute">
        A dash means the city is missing on that side; its combined score then uses the other side alone. {rows.length > shown.length ? `Top ${shown.length} of ${rows.length} cities.` : ""}
      </span>
    </section>
  );
}

/**
 * Every number in a ranking row, traced: the Qloo heat and requests behind the Qloo signal, the
 * rows of the uploaded file behind Your data, and the arithmetic of Combined. All values shown
 * here are the engine's or the file's; nothing is computed for display.
 */
function Trace({
  row,
  name,
  ranking,
  metric,
  metricLabel,
  info,
}: {
  row: CombinedCity;
  name: string;
  ranking: RankingData;
  metric: string;
  metricLabel: string;
  info: Map<string, { name: string }>;
}) {
  const q = ranking.trace.qloo;
  const parts = q?.byCity[row.cityId]?.parts ?? [];
  const rows = ranking.trace.upload.rows[metric]?.[row.cityId] ?? [];
  const n = (x: number) => x.toLocaleString("en-GB");
  const w = row.weight;
  return (
    <div className="mt-2 flex flex-col gap-2.5 rounded-md bg-bg p-3 text-chip" data-trace={name}>
      <div className="flex flex-col gap-1.5">
        <span className="flex flex-wrap items-center gap-2">
          <SourceBadge />
          {row.qloo === null ? (
            <span>Qloo has no heat for {name} in this market, so there is no Qloo signal.</span>
          ) : q?.rule === "both" && parts.length === 2 ? (
            <span>
              {pct(row.qloo)} = √({parts[0].label} {parts[0].heat.toFixed(2)} over {parts[0].cells} cells × {parts[1].label} {parts[1].heat.toFixed(2)} over {parts[1].cells} cells), each against
              its hottest city in the market.
            </span>
          ) : parts[0] && q?.hottest ? (
            <span>
              {pct(row.qloo)} = {parts[0].label}&apos; heat in {name}, {parts[0].heat.toFixed(3)} over {parts[0].cells} cells, ÷ their hottest city&apos;s,{" "}
              {info.get(q.hottest.cityId)?.name ?? "the hottest city"} {q.hottest.heat.toFixed(3)}.
            </span>
          ) : (
            <span>{pct(row.qloo)}, from the plan&apos;s city step.</span>
          )}
        </span>
        {row.qloo !== null && q && (
          <details>
            <summary className="cursor-pointer text-acc-text">Qloo requests</summary>
            <div className="pt-1.5">
              <Calls calls={q.calls} />
            </div>
          </details>
        )}
      </div>
      <span className="flex flex-wrap items-center gap-2">
        <YourDataBadge />
        {row.raw === null || !row.scale ? (
          <span>{name} is not in {ranking.trace.upload.fileName}.</span>
        ) : (
          <span>
            {pct(row.yours ?? 0)} = {metricLabel.toLowerCase()} in {name}, {n(row.raw)} (
            {rows.map((x) => `row ${x.row} “${x.rawCity}” ${n(x.value)}`).join(" + ")} in {ranking.trace.upload.fileName}), ÷ your best city&apos;s,{" "}
            {info.get(row.scale.cityId)?.name ?? "your best city"} {n(row.scale.raw)}.
          </span>
        )}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <CombinedBadge />
        <span>
          {row.basis === "both"
            ? `${pct(row.combined)} = ${(1 - w).toFixed(1)} × ${pct(row.qloo ?? 0)} + ${w.toFixed(1)} × ${pct(row.yours ?? 0)}.`
            : row.basis === "qloo"
              ? `${pct(row.combined)} = the Qloo signal alone: ${name} is not in your file.`
              : `${pct(row.combined)} = your data alone: Qloo has no heat for ${name}.`}
        </span>
      </span>
    </div>
  );
}

/* ---------- One dataset ---------- */

async function post<T>(url: string, body: unknown, method = "POST"): Promise<{ ok: boolean; data: T & { error?: string } }> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
  return { ok: Boolean(res?.ok), data: ((await res?.json().catch(() => null)) ?? { error: "That didn't work. Try again." }) as T & { error?: string } };
}

export function DatasetScreen({ initial }: { initial: DatasetView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const url = `/api/workspace/datasets/${view.summary.id}`;
  const reload = async () => {
    const res = await fetch(url).catch(() => null);
    if (res?.ok) setView((await res.json()) as DatasetView);
  };
  const s = view.summary;

  const remove = async () => {
    const { ok, data } = await post(url, {}, "DELETE");
    if (ok) router.push("/workspace/data?deleted=1");
    else setError(data.error ?? "That didn't work.");
  };

  return (
    <div className="flex flex-col gap-[18px]">
      <DataSteps at={3} />
      {error && <Banner tone="err">{error}</Banner>}
      {view.qlooNote && <Banner tone="warn">{view.qlooNote}</Banner>}
      <Panel>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <MonoLabel>{s.name}</MonoLabel>
          <YourDataBadge />
        </div>
        <span className="text-chip text-mute">
          {s.rows.toLocaleString("en-GB")} rows · {s.matchedRows.toLocaleString("en-GB")} matched to a city · {s.metrics.map((m) => m.label).join(", ")} · uploaded{" "}
          {new Date(s.uploadedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          {s.uploadedBy ? ` by ${s.uploadedBy}` : ""}
        </span>
        {view.canEdit && <Attach view={view} onDone={reload} onError={setError} />}
      </Panel>
      {view.review.length > 0 && <Review id={s.id} items={view.review} canEdit={view.canEdit} onDone={reload} />}
      <Panel>
        <CityRanking ranking={view.ranking} title={`City ranking${s.entity ? ` · ${s.entity.name}` : ""}`} />
      </Panel>
      {view.canEdit && (
        <Panel>
          <MonoLabel>Delete</MonoLabel>
          <span className="text-chip text-mute">Removes every row and the uploaded file from this workspace. Plans stop showing this data at once.</span>
          <div>
            <Button onClick={() => void remove()}>Delete this data and its file</Button>
          </div>
        </Panel>
      )}
    </div>
  );
}

function Attach({ view, onDone, onError }: { view: DatasetView; onDone: () => Promise<void>; onError: (e: string | null) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<{ question: string; choices: { entityId: string; name: string; category: string; detail?: string }[] } | null>(null);
  const entity = view.summary.entity;
  const url = `/api/workspace/datasets/${view.summary.id}/attach`;

  const attach = async (query: string, entityId?: string) => {
    setBusy(true);
    onError(null);
    const { ok, data } = await post<{ status: string; question?: string; choices?: { entityId: string; name: string; category: string; detail?: string }[] }>(url, { query, entityId });
    setBusy(false);
    if (!ok) return onError(data.error ?? "That didn't work.");
    if (data.status === "choose") return setChoices({ question: data.question ?? "Which one?", choices: data.choices ?? [] });
    if (data.status === "none") return onError(`Qloo has no entity matching “${query}”.`);
    setChoices(null);
    setQ("");
    await onDone();
  };

  if (entity) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-chip">
        <span>
          Attached to <strong>{entity.name}</strong>. Plans for {entity.name} in this workspace show this data in their city step.
        </span>
        <Button
          onClick={async () => {
            await post(url, { detach: true });
            await onDone();
          }}
        >
          Detach
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim()) void attach(q.trim());
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Which fanbase is this data about?" aria-label="Attach to a fanbase" maxLength={100} className={cx(FIELD, "min-w-0 flex-1 basis-[220px]")} />
        <Button type="submit" variant="primary" loading={busy} disabled={!q.trim()} className="min-h-[40px] px-4">
          Attach
        </Button>
      </form>
      {choices && (
        <div className="flex flex-col gap-1.5">
          <span className="text-chip text-mute">{choices.question}</span>
          <div className="flex flex-wrap gap-1.5">
            {choices.choices.map((c) => (
              <Button key={c.entityId} variant="pick" onClick={() => void attach(c.name, c.entityId)}>
                {c.name} · {c.category.replace("_", " ")}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Review({ id, items, canEdit, onDone }: { id: string; items: ReviewItem[]; canEdit: boolean; onDone: () => Promise<void> }) {
  const url = `/api/workspace/datasets/${id}/review`;
  const [searches, setSearches] = useState<Record<string, { q: string; options: CityOption[] | null }>>({});
  const key = (i: ReviewItem) => `${i.rawCity}|${i.rawCountry ?? ""}`;
  const resolve = async (i: ReviewItem, cityId: string | null) => {
    await post(url, { rawCity: i.rawCity, rawCountry: i.rawCountry, cityId });
    await onDone();
  };
  const search = async (i: ReviewItem) => {
    const q = searches[key(i)]?.q ?? "";
    const { data } = await post<{ options: CityOption[] }>(url, { rawCity: i.rawCity, rawCountry: i.rawCountry, search: q });
    setSearches({ ...searches, [key(i)]: { q, options: data.options ?? [] } });
  };
  const place = (o: CityOption) => `${o.name}, ${o.admin1 || o.country}${o.admin1 ? ` (${o.country})` : ""}`;

  return (
    <Panel>
      <MonoLabel className="text-warn">Check {items.length} city name{items.length === 1 ? "" : "s"}</MonoLabel>
      <span className="text-chip text-mute">These rows are left out of the ranking until you pick a city or skip them.</span>
      <ul className="m-0 flex list-none flex-col p-0" aria-label="Cities to check">
        {items.map((i) => {
          const s = searches[key(i)];
          const options = s?.options ?? i.options;
          return (
            <li key={key(i)} className="flex flex-col gap-2 border-b border-line py-3" data-review={i.rawCity}>
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold">{i.rawCity}</span>
                {i.rawCountry && <span className="text-chip text-mute">{i.rawCountry}</span>}
                <OutlineChip>
                  {i.status === "ambiguous" ? "More than one city" : "Not found"} · {i.rows} row{i.rows === 1 ? "" : "s"}
                </OutlineChip>
                <span className="flex-1" />
                {canEdit && <Button onClick={() => void resolve(i, null)}>Skip</Button>}
              </div>
              {canEdit && options.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {options.map((o) => (
                    <Button key={o.id} variant="pick" onClick={() => void resolve(i, o.id)}>
                      {place(o)}
                    </Button>
                  ))}
                </div>
              )}
              {canEdit && s?.options?.length === 0 && <span className="text-chip text-mute">No GeoNames city of 100,000+ people by that name.</span>}
              {canEdit && (
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void search(i);
                  }}
                >
                  <input
                    value={s?.q ?? ""}
                    onChange={(e) => setSearches({ ...searches, [key(i)]: { q: e.target.value, options: s?.options ?? null } })}
                    placeholder="Try another spelling, e.g. Portland, OR"
                    aria-label={`Search a city for ${i.rawCity}`}
                    className={cx(FIELD, "min-w-0 flex-1 basis-[200px] py-1.5 text-chip")}
                  />
                  <Button type="submit">Search</Button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/* ---------- In a plan's city step ---------- */

/**
 * For workspace members: the plan's city scores beside the workspace's data for its fanbase.
 * Fetched from a members-only route; the plan itself never holds user data.
 */
export function PlanYourData({ planId, chosenCityId, onUseCity }: { planId: string; chosenCityId?: string; onUseCity?: (cityId: string) => void }) {
  const [found, setFound] = useState<{ dataset: { id: string; name: string } | null; ranking?: RankingData } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/workspace/datasets/for-plan?planId=${encodeURIComponent(planId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setFound(d))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [planId]);
  if (!found?.dataset || !found.ranking) return null;
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4" data-plan-your-data>
      <div className="flex flex-wrap items-center gap-2 text-chip text-mute">
        <YourDataBadge />
        <span>
          From {found.dataset.name}, visible to this workspace only.{" "}
          <a href={`/workspace/data/${found.dataset.id}`}>Open the data</a>
        </span>
      </div>
      <CityRanking ranking={found.ranking} title="Cities · Qloo signal, your data, combined" chosenCityId={chosenCityId} onUseCity={onUseCity} />
    </div>
  );
}
