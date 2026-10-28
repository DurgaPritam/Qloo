import "server-only";

import type { Plan } from "@/lib/agent/types";
import type { WorkspaceRepo } from "@/lib/db/scoped";
import { InputError } from "@/lib/db/scoped";
import type { MatchStatus } from "@/lib/db/schema";
import { scoreCityHeat } from "@/lib/engine/cities";
import { cityIndex, matchCity, type CityIndex } from "@/lib/engine/city-match";
import type { CityMetric, CityQlooScore } from "@/lib/engine/combine";
import { CITIES } from "@/lib/engine/data";
import { countryCode, marketFor } from "@/lib/engine/markets";
import type { City, Entity } from "@/lib/engine/types";
import type { QlooScope } from "@/lib/qloo/allowance";
import { BudgetExceededError } from "@/lib/qloo/errors";
import type { QlooSource } from "@/lib/qloo/source";
import { profileAct } from "@/lib/roster/profile";
import { profileStale } from "@/lib/roster/plan";
import { profileKey } from "@/lib/roster/service";
import type { RosterEntity } from "@/lib/roster/types";
import { metroPool } from "@/lib/tools/shared";
import type { FileStore } from "@/lib/files/store";
import { can } from "@/lib/workspace/permissions";

import { parseNumber, readTable, TableError } from "./table";
import { METRIC_LABEL, type CityOption, type ColumnRole, type DatasetSummary, type DatasetView, type MetricDef, type ReviewItem } from "./types";

/**
 * The user's own data (docs/roadmap-rules.md, rule 2). It is read only by these functions and
 * the workspace routes; nothing in lib/agent or lib/llm imports it, so it never reaches a prompt.
 */

let index: CityIndex | undefined;
function cities(): CityIndex {
  index ??= cityIndex(CITIES, metroPool());
  return index;
}
const byId = () => new Map(metroPool().map((c) => [c.id, c]));
let metroById: Map<string, City> | undefined;
export function metroCity(id: string): City | undefined {
  metroById ??= byId();
  return metroById.get(id);
}

const option = (c: City): CityOption => ({ id: c.id, name: c.name, admin1: c.admin1, country: c.country });

export interface Upload {
  name: string;
  bytes: Uint8Array;
  /** Column name → what it is for. */
  mapping: Record<string, ColumnRole>;
}

/** Checks the mapping: one city column, at most one country column, at least one metric. */
export function metricsFor(mapping: Record<string, ColumnRole>, columns: readonly string[]): { city: string; country: string | null; metrics: MetricDef[] } {
  const entries = columns.map((c) => [c, mapping[c] ?? { role: "ignore" }] as const);
  const city = entries.filter(([, r]) => r.role === "city").map(([c]) => c);
  const country = entries.filter(([, r]) => r.role === "country").map(([c]) => c);
  const metrics = entries.flatMap(([column, r], i): MetricDef[] =>
    r.role === "metric" ? [{ key: `m${i}`, kind: r.kind, label: r.kind === "other" ? column : METRIC_LABEL[r.kind], column }] : [],
  );
  if (city.length !== 1) throw new InputError("Map exactly one column to City.");
  if (country.length > 1) throw new InputError("Map at most one column to Country.");
  if (!metrics.length) throw new InputError("Map at least one column to a metric (tickets sold, streams, signups, revenue).");
  return { city: city[0], country: country[0] ?? null, metrics };
}

/**
 * Reads the file, matches each row's city to a GeoNames metro, stores the file privately and the
 * rows with source "user". Rows with no city are dropped and counted. The file is removed again
 * if the rows cannot be saved.
 */
export async function ingest(repo: WorkspaceRepo, upload: Upload, store: FileStore) {
  let table;
  try {
    table = readTable(upload.bytes, upload.name);
  } catch (err) {
    if (err instanceof TableError) throw new InputError(err.message);
    throw err;
  }
  const { city, country, metrics } = metricsFor(upload.mapping, table.columns);
  const col = (name: string) => table.columns.indexOf(name);
  const [cityCol, countryCol] = [col(city), country ? col(country) : -1];

  const memo = new Map<string, ReturnType<typeof matchCity>>();
  const match = (raw: string, rawCountry: string | null) => {
    const key = `${raw}\u0000${rawCountry ?? ""}`;
    if (!memo.has(key)) memo.set(key, matchCity(raw, cities(), { country: rawCountry, countryCode: (n) => countryCode(n), countryName: (c) => marketFor(c)?.name }));
    return memo.get(key)!;
  };

  let dropped = 0;
  const rows = table.rows.flatMap((r, i) => {
    const rawCity = r[cityCol]?.trim() ?? "";
    if (!rawCity) {
      dropped++;
      return [];
    }
    const rawCountry = countryCol >= 0 ? r[countryCol]?.trim() || null : null;
    const m = match(rawCity.slice(0, 120), rawCountry);
    const status: MatchStatus = m.status;
    return [
      {
        rowNumber: i + 2,
        rawCity: rawCity.slice(0, 120),
        rawCountry: rawCountry?.slice(0, 60) ?? null,
        cityId: m.status === "matched" ? m.city.id : null,
        matchStatus: status,
        matchNote: m.status === "matched" ? (m.note ?? null) : null,
        options: m.status === "ambiguous" ? m.options.map(option) : null,
        metrics: Object.fromEntries(metrics.map((d) => [d.key, parseNumber(r[col(d.column)] ?? "")])),
      },
    ];
  });
  if (!rows.length) throw new InputError("No rows with a city name.");

  const safe = upload.name.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-80);
  const kind = upload.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";
  const fileKey = await store.put(
    `datasets/${repo.context.workspaceId}/${crypto.randomUUID()}-${safe}`,
    upload.bytes,
    kind === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  try {
    const id = await repo.datasets.create({ name: upload.name.slice(0, 120), fileKind: kind, fileKey, fileBytes: upload.bytes.byteLength, cityColumn: city, countryColumn: country, metrics, rows });
    return { id, rows: rows.length, dropped, truncated: table.truncated };
  } catch (err) {
    await store.delete(fileKey).catch(() => {});
    throw err;
  }
}

type Row = Awaited<ReturnType<WorkspaceRepo["datasets"]["rows"]>>[number];

/** City names a person has to look at: ambiguous ones with their options, and ones not found. */
export function reviewItems(rows: readonly Row[]): ReviewItem[] {
  const groups = new Map<string, ReviewItem>();
  for (const r of rows) {
    if (r.matchStatus !== "ambiguous" && r.matchStatus !== "unmatched") continue;
    const key = `${r.rawCity}\u0000${r.rawCountry ?? ""}`;
    const g = groups.get(key) ?? { rawCity: r.rawCity, rawCountry: r.rawCountry, status: r.matchStatus, rows: 0, options: r.options ?? [] };
    g.rows++;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.rows - a.rows || a.rawCity.localeCompare(b.rawCity));
}

/** The metric summed per matched city, for combineCityScores. */
export function metricByCity(rows: readonly Row[], metricKey: string): CityMetric[] {
  return rows.flatMap((r) => {
    const v = r.metrics[metricKey];
    return r.cityId && (r.matchStatus === "matched" || r.matchStatus === "manual") && typeof v === "number" ? [{ cityId: r.cityId, value: v }] : [];
  });
}

export function summarise(d: NonNullable<Awaited<ReturnType<WorkspaceRepo["datasets"]["get"]>>>, rows: readonly Row[], uploader: string | null): DatasetSummary {
  return {
    id: d.id,
    name: d.name,
    fileKind: d.fileKind,
    metrics: d.metrics,
    rows: rows.length,
    matchedRows: rows.filter((r) => r.matchStatus === "matched" || r.matchStatus === "manual").length,
    review: reviewItems(rows).length,
    entity: d.entityId && d.entityName && d.entityCategory ? { id: d.entityId, name: d.entityName, category: d.entityCategory } : null,
    uploadedAt: d.uploadedAt.toISOString(),
    uploadedBy: uploader,
  };
}

/** "Portland" typed again by a person: the options to pick from (never applied without a click). */
export function searchCity(raw: string, country: string | null): CityOption[] {
  const m = matchCity(raw, cities(), { country, countryCode: (n) => countryCode(n), countryName: (c) => marketFor(c)?.name });
  return m.status === "matched" ? [option(m.city)] : m.status === "ambiguous" ? m.options.map(option) : [];
}

/**
 * Qloo's signal per city for a fanbase on its own: its heat in its home market, normalised 0–1
 * against its hottest city (scoreCityHeat, the plan's city scoring). From the shared profile
 * cache when it is under a week old; otherwise the profile is built (4 Qloo calls) and cached.
 */
export async function fanbaseCityScores(
  repo: WorkspaceRepo,
  entity: RosterEntity,
  source: QlooSource,
  scope: QlooScope,
): Promise<{ market: string; scores: CityQlooScore[]; calls: number }> {
  const key = profileKey(entity.id, source.mock);
  const cached = (await repo.entityProfiles.get([key]))[0];
  let profile = cached && !profileStale({ profileAt: cached.refreshedAt }, new Date()) ? cached.profile : null;
  let calls = 0;
  if (!profile) {
    const runId = `data-${crypto.randomUUID()}`;
    profile = await profileAct({ ...entity, popularity: entity.popularity ?? 0 } as Entity, source, { runId, scope });
    calls = profile.calls?.filter((c) => !c.cached).length ?? 0;
    await repo.entityProfiles.put(key, profile, new Date());
  }
  const pool = metroPool().filter((c) => c.country === profile.market);
  const heat = new Map(Object.entries(profile.heat).map(([id, [mean, cells]]) => [id, { mean, cells }]));
  const scores = scoreCityHeat(heat, heat, pool, 0)
    .filter((s) => s.combined > 0)
    .map((s) => ({ cityId: s.city.id, score: s.combined }));
  return { market: profile.market, scores, calls };
}

/** A plan's own city scores (fanbase with partner), for the plan's city step. */
export function planCityScores(plan: Plan): CityQlooScore[] {
  const ranked = plan.city?.ranked ?? plan.city?.map ?? [];
  return ranked.map((c) => ({ cityId: c.id, score: c.combined }));
}

/** Names and places for the cities a ranking shows. */
export function cityInfo(ids: Iterable<string>) {
  return [...new Set(ids)].flatMap((id) => {
    const c = metroCity(id);
    return c ? [{ id: c.id, name: c.name, admin1: c.admin1, country: c.country, lat: c.lat, lon: c.lon }] : [];
  });
}

/** Deletes the dataset, its rows and its file. One click in the UI. */
export async function deleteDataset(repo: WorkspaceRepo, id: string, store: FileStore) {
  const fileKey = await repo.datasets.remove(id);
  if (fileKey === null) return false;
  await store.delete(fileKey);
  return true;
}

export type { Row as DatasetRow };

/** Everything the dataset page shows. Qloo scores only once a fanbase is attached. */
export async function datasetView(
  repo: WorkspaceRepo,
  id: string,
  qloo: (entity: RosterEntity) => Promise<CityQlooScore[]>,
): Promise<DatasetView | null> {
  const d = await repo.datasets.get(id);
  if (!d) return null;
  const rows = await repo.datasets.rows(id);
  const list = await repo.datasets.list();
  const meta = list.find((x) => x.id === id);
  let scores: CityQlooScore[] | null = null;
  let qlooNote: string | null = null;
  if (d.entityId && d.entityName && d.entityCategory) {
    try {
      scores = await qloo({ id: d.entityId, name: d.entityName, category: d.entityCategory, popularity: 0 });
    } catch (err) {
      qlooNote = err instanceof BudgetExceededError ? `${err.message}; showing your data only.` : "Qloo did not answer, so this shows your data only. Try again later.";
    }
  }
  const totals = Object.fromEntries(d.metrics.map((m) => [m.key, metricByCity(rows, m.key)]));
  const ids = [...(scores ?? []).map((s) => s.cityId), ...Object.values(totals).flatMap((t) => t.map((x) => x.cityId))];
  return {
    summary: summarise(d, rows, meta?.uploader ?? meta?.uploaderEmail ?? null),
    review: reviewItems(rows),
    ranking: {
      qloo: scores,
      qlooLabel: d.entityName ? `${d.entityName} fans' heat` : "",
      metrics: d.metrics.map((m) => ({ key: m.key, label: m.label })),
      totals,
      cities: cityInfo(ids),
    },
    canEdit: can(repo.context.role, "data.edit"),
    qlooNote,
  };
}
