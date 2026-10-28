import { ENGINE_CONFIG } from "./config";
import { distanceKm } from "./geo";

/**
 * Tour optimizer. Picks and orders stops to maximise
 *   objective = Σ score × 100 − distanceWeight × totalKm ÷ 1,000
 * inside hard constraints that are never broken: number of stops, maximum leg, start and end,
 * cities to include and exclude, and a minimum spacing between stops. Exact search when the
 * candidates are few; otherwise greedy cheapest insertion, then 2-opt, then swaps (documented
 * below). Ties always break on city id, so the same inputs give the same route.
 */
export interface RouteCity {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  /** 0–1: the fanbase's heat here, scaled to the hottest city in the whole region (what the route uses). */
  score: number;
  /** 0–1: the same heat against the hottest city in its own country; for display only. */
  countryScore?: number;
  /** Heat cells near the city, for evidence; 0 when Qloo had none. */
  cells: number;
}

export interface RouteConstraints {
  stops: number;
  /** Null: no limit. */
  maxLegKm: number | null;
  startId?: string | null;
  endId?: string | null;
  include?: readonly string[];
  exclude?: readonly string[];
  /** Overrides for tests and the UI's shown weight; default from config. */
  distanceWeight?: number;
  minSpacingKm?: number;
}

export interface RouteStop {
  city: RouteCity;
  /** Distance from the previous stop, km, rounded; 0 for the first. */
  legKm: number;
  /** Why it is on the route. */
  role: "start" | "end" | "included" | "chosen";
}

export type WhyNotReason =
  | { kind: "excluded"; text: string }
  | { kind: "spacing"; text: string; near: string; km: number }
  | { kind: "max_leg"; text: string }
  | { kind: "objective"; text: string; delta: number };

export interface RouteResult {
  stops: RouteStop[];
  totalKm: number;
  /** Σ score × 100 over the stops. */
  scoreSum: number;
  /** distanceWeight × totalKm ÷ 1,000. */
  penalty: number;
  objective: number;
  distanceWeight: number;
  method: "exact" | "heuristic";
  /** Strong cities that are not on the route, each with the constraint or trade-off that kept it off. */
  whyNot: { city: RouteCity; reason: WhyNotReason }[];
  /** Set when the constraints cannot all be met: no route is returned, and this says why. */
  infeasible: string | null;
  /** When fewer stops than asked fit. */
  note: string | null;
}

const km = (a: RouteCity, b: RouteCity) => distanceKm(a.lat, a.lon, b.lat, b.lon);
const byId = (a: RouteCity, b: RouteCity) => a.id.localeCompare(b.id);

function totals(path: readonly RouteCity[], w: number) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += km(path[i - 1], path[i]);
  const scoreSum = path.reduce((s, c) => s + c.score * 100, 0);
  return { totalKm: total, scoreSum, penalty: (w * total) / 1000, objective: scoreSum - (w * total) / 1000 };
}

interface Ctx {
  w: number;
  maxLeg: number;
  spacing: number;
  start: RouteCity | null;
  end: RouteCity | null;
  forced: RouteCity[];
}

const legOk = (a: RouteCity, b: RouteCity, ctx: Ctx) => km(a, b) <= ctx.maxLeg;
const spaced = (c: RouteCity, path: readonly RouteCity[], ctx: Ctx) => path.every((p) => p.id === c.id || km(p, c) >= ctx.spacing);

/** Every constraint, checked on a finished path (the guard behind "never broken"). */
export function satisfies(path: readonly RouteCity[], c: RouteConstraints, cities: readonly RouteCity[]): boolean {
  const maxLeg = c.maxLegKm ?? Infinity;
  const spacing = c.minSpacingKm ?? ENGINE_CONFIG.route.minSpacingKm;
  const ids = path.map((p) => p.id);
  if (new Set(ids).size !== ids.length) return false;
  if (path.length > Math.min(c.stops, ENGINE_CONFIG.route.maxStops)) return false;
  if (c.startId && ids[0] !== c.startId) return false;
  if (c.endId && ids.at(-1) !== c.endId) return false;
  if ((c.include ?? []).some((id) => cities.some((x) => x.id === id) && !ids.includes(id))) return false;
  if ((c.exclude ?? []).some((id) => ids.includes(id))) return false;
  for (let i = 1; i < path.length; i++) if (km(path[i - 1], path[i]) > maxLeg) return false;
  for (let i = 0; i < path.length; i++) for (let j = i + 1; j < path.length; j++) if (km(path[i], path[j]) < spacing) return false;
  return true;
}

/** Exact: every ordered choice of k candidates, with bounds. Used when candidates ≤ exactMaxCandidates. */
function exact(pool: RouteCity[], k: number, ctx: Ctx): RouteCity[] | null {
  let best: RouteCity[] | null = null;
  let bestObj = -Infinity;
  const path: RouteCity[] = [];
  const top = [...pool].sort((a, b) => b.score - a.score || byId(a, b));
  const visit = (score: number, dist: number) => {
    const n = path.length;
    // Upper bound: the best scores still free, with no more distance.
    let bound = score;
    let free = k - n;
    for (const c of top) {
      if (!free) break;
      if (!path.includes(c)) {
        bound += c.score * 100;
        free--;
      }
    }
    if (bound - (ctx.w * dist) / 1000 < bestObj - 1e-9) return;
    if (n === k) {
      if (ctx.end && path[k - 1] !== ctx.end) return;
      if (ctx.forced.some((f) => !path.includes(f))) return;
      const obj = score - (ctx.w * dist) / 1000;
      if (obj > bestObj + 1e-9 || (Math.abs(obj - bestObj) <= 1e-9 && best && key(path) < key(best))) {
        bestObj = obj;
        best = [...path];
      }
      return;
    }
    // Forced cities still missing must fit in the slots left.
    if (ctx.forced.filter((f) => !path.includes(f)).length > k - n) return;
    for (const c of pool) {
      if (path.includes(c)) continue;
      if (n === 0 && ctx.start && c !== ctx.start) continue;
      if (ctx.start && c === ctx.start && n !== 0) continue;
      if (ctx.end && c === ctx.end && n !== k - 1) continue;
      const last = path[n - 1];
      if (last && !legOk(last, c, ctx)) continue;
      if (!spaced(c, path, ctx)) continue;
      path.push(c);
      visit(score + c.score * 100, dist + (last ? km(last, c) : 0));
      path.pop();
    }
  };
  visit(0, 0);
  return best;
}

const key = (p: readonly RouteCity[]) => p.map((c) => c.id).join(">");

/**
 * Heuristic for many candidates:
 * 1. Start from the fixed cities (start, end, includes), placed by cheapest insertion.
 * 2. Greedy: repeatedly add the city and position with the largest gain, until the route has k
 *    stops or nothing fits the spacing rule.
 * 3. 2-opt: reverse any segment (not moving a fixed start or end) that improves the route.
 * 4. Swap: replace any non-fixed stop with an unused city at its best position when that improves
 *    the route; 2-opt again after each swap. Stops when a full pass finds nothing (bounded).
 * While building, a leg over the maximum is allowed but costs LEG_EXCESS points per km over, so
 * the search inserts cities that bridge long legs (a fixed start and end may be far apart). The
 * finished route is then held to every constraint by `satisfies`; if it fails, no route is given.
 */
const LEG_EXCESS = 10;

function heuristic(pool: RouteCity[], k: number, ctx: Ctx): RouteCity[] | null {
  const excess = (p: readonly RouteCity[]) => {
    let over = 0;
    for (let i = 1; i < p.length; i++) over += Math.max(0, km(p[i - 1], p[i]) - ctx.maxLeg);
    return over;
  };
  const soft = (p: readonly RouteCity[]) => totals(p, ctx.w).objective - LEG_EXCESS * excess(p);
  const fixedMid = ctx.forced.filter((f) => f !== ctx.start && f !== ctx.end).sort((a, b) => b.score - a.score || byId(a, b));
  let path: RouteCity[] = [];
  if (ctx.start) path.push(ctx.start);
  if (ctx.end && ctx.end !== ctx.start) path.push(ctx.end);
  const firstSlot = () => (ctx.start ? 1 : 0);
  const lastSlot = (p: readonly RouteCity[]) => (ctx.end ? p.length - 1 : p.length);

  /** The best place for `c` in `p` by the soft objective; null when it breaks the spacing rule. */
  const bestInsert = (p: readonly RouteCity[], c: RouteCity) => {
    if (!spaced(c, p, ctx)) return null;
    let best: { at: number; value: number } | null = null;
    for (let at = firstSlot(); at <= lastSlot(p); at++) {
      const value = soft([...p.slice(0, at), c, ...p.slice(at)]);
      if (!best || value > best.value + 1e-9) best = { at, value };
    }
    return best;
  };

  for (const f of fixedMid) {
    const ins = bestInsert(path, f);
    if (!ins) return null;
    path.splice(ins.at, 0, f);
  }

  const grow = (p: RouteCity[]) => {
    while (p.length < k) {
      let pick: { c: RouteCity; at: number; value: number } | null = null;
      for (const c of pool) {
        if (p.includes(c)) continue;
        const ins = bestInsert(p, c);
        if (ins && (!pick || ins.value > pick.value + 1e-9 || (Math.abs(ins.value - pick.value) <= 1e-9 && byId(c, pick.c) < 0))) pick = { c, ...ins };
      }
      if (!pick) break;
      p.splice(pick.at, 0, pick.c);
    }
    return p;
  };
  const twoOpt = (p: RouteCity[]) => {
    let improved = true;
    let guard = 0;
    while (improved && guard++ < 200) {
      improved = false;
      for (let i = firstSlot(); i < lastSlot(p) - 1; i++) {
        for (let j = i + 1; j < lastSlot(p); j++) {
          const next = [...p.slice(0, i), ...p.slice(i, j + 1).reverse(), ...p.slice(j + 1)];
          if (soft(next) > soft(p) + 1e-9) {
            p = next;
            improved = true;
          }
        }
      }
    }
    return p;
  };

  path = twoOpt(grow(path));
  for (let pass = 0; pass < 30; pass++) {
    let changed = false;
    for (const out of [...path]) {
      if (ctx.forced.includes(out)) continue;
      for (const c of pool) {
        if (path.includes(c)) continue;
        const without = path.filter((x) => x !== out);
        const ins = bestInsert(without, c);
        if (!ins) continue;
        const next = [...without];
        next.splice(ins.at, 0, c);
        const tried = twoOpt(next);
        if (soft(tried) > soft(path) + 1e-9) {
          path = tried;
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
    if (!changed) break;
  }
  return excess(path) > 0 ? null : path;
}

export function optimizeRoute(cityScores: readonly RouteCity[], constraints: RouteConstraints): RouteResult {
  const cfg = ENGINE_CONFIG.route;
  const w = constraints.distanceWeight ?? cfg.distanceWeight;
  const spacing = constraints.minSpacingKm ?? cfg.minSpacingKm;
  const exclude = new Set(constraints.exclude ?? []);
  const all = [...new Map(cityScores.map((c) => [c.id, c])).values()].sort(byId);
  const find = (id?: string | null) => (id ? (all.find((c) => c.id === id) ?? null) : null);
  const start = find(constraints.startId);
  const end = find(constraints.endId);
  const include = (constraints.include ?? []).map((id) => find(id)).filter((c): c is RouteCity => c !== null);
  const forced = [...new Set([start, ...include, end].filter((c): c is RouteCity => c !== null))];
  const k = Math.max(1, Math.min(constraints.stops, cfg.maxStops));
  const ctx: Ctx = { w, maxLeg: constraints.maxLegKm ?? Infinity, spacing, start, end, forced };
  const empty = (why: string): RouteResult => ({ stops: [], totalKm: 0, scoreSum: 0, penalty: 0, objective: 0, distanceWeight: w, method: "exact", whyNot: [], infeasible: why, note: null });

  const clash = forced.find((f) => exclude.has(f.id));
  if (clash) return empty(`${clash.name} is both required and excluded.`);
  if (forced.length > k) return empty(`${forced.length} cities are required (start, end and includes), more than the ${k} stops asked for.`);
  for (let i = 0; i < forced.length; i++) {
    for (let j = i + 1; j < forced.length; j++) {
      const d = km(forced[i], forced[j]);
      if (d < spacing) return empty(`${forced[i].name} and ${forced[j].name} are ${Math.round(d)} km apart, under the ${spacing} km minimum between stops.`);
    }
  }

  const eligible = all.filter((c) => !exclude.has(c.id));
  const strong = [...eligible].sort((a, b) => b.score - a.score || byId(a, b));
  const pool = [...new Set([...forced, ...strong.slice(0, cfg.candidatePool)])];
  const method: RouteResult["method"] = pool.length <= cfg.exactMaxCandidates ? "exact" : "heuristic";

  // Ask for k stops; if no route of k fits the constraints, the most stops that do.
  let path: RouteCity[] | null = null;
  let got = k;
  for (let n = Math.min(k, pool.length); n >= Math.max(forced.length, 1); n--) {
    path = method === "exact" ? exact(pool, n, ctx) : heuristic(pool, n, ctx);
    if (path && path.length >= Math.min(n, pool.length) && satisfies(path, { ...constraints, stops: k, minSpacingKm: spacing }, all)) {
      got = path.length;
      break;
    }
    path = null;
  }
  if (!path || !path.length) {
    const leg = constraints.maxLegKm ? ` with every leg under ${constraints.maxLegKm.toLocaleString("en-GB")} km` : "";
    return empty(`No route fits all your constraints${leg}. Raise the maximum leg, or drop a required city.`);
  }

  const t = totals(path, w);
  const stops: RouteStop[] = path.map((c, i) => ({
    city: c,
    legKm: i === 0 ? 0 : Math.round(km(path![i - 1], c)),
    role: c === start ? "start" : c === end ? "end" : include.includes(c) ? "included" : "chosen",
  }));
  return {
    stops,
    totalKm: Math.round(t.totalKm),
    scoreSum: t.scoreSum,
    penalty: t.penalty,
    objective: t.objective,
    distanceWeight: w,
    method,
    whyNot: whyNot(all, path, constraints, ctx, exclude),
    infeasible: null,
    note: got < k ? `Only ${got} stop${got === 1 ? "" : "s"} fit your constraints.` : null,
  };
}

/**
 * For the strongest cities left off, the first thing that kept each off: your exclusion, the
 * spacing from a stop, the leg limit at every position, or the objective (adding it in its best
 * spot, in place of the weakest stop you did not require, scores lower).
 */
function whyNot(all: RouteCity[], path: RouteCity[], c: RouteConstraints, ctx: Ctx, exclude: Set<string>) {
  const out: { city: RouteCity; reason: WhyNotReason }[] = [];
  const left = all.filter((x) => !path.includes(x) && x.score > 0).sort((a, b) => b.score - a.score || byId(a, b));
  const base = totals(path, ctx.w).objective;
  for (const city of left.slice(0, ENGINE_CONFIG.route.whyNot)) {
    if (exclude.has(city.id)) {
      out.push({ city, reason: { kind: "excluded", text: "You excluded it." } });
      continue;
    }
    const near = path.find((p) => km(p, city) < ctx.spacing);
    if (near) {
      const d = Math.round(km(near, city));
      out.push({ city, reason: { kind: "spacing", text: `${d} km from ${near.name}, under the ${ctx.spacing} km minimum between stops.`, near: near.name, km: d } });
      continue;
    }
    // Try it in place of each stop you did not require, at its best position.
    let bestObj = -Infinity;
    let fits = false;
    const swappable = path.filter((p) => !ctx.forced.includes(p));
    const bases = path.length < c.stops ? [path, ...swappable.map((s) => path.filter((p) => p !== s))] : swappable.map((s) => path.filter((p) => p !== s));
    for (const b of bases) {
      for (let at = ctx.start ? 1 : 0; at <= (ctx.end ? b.length - 1 : b.length); at++) {
        const next = [...b.slice(0, at), city, ...b.slice(at)];
        if (!next.every((x, i) => i === 0 || legOk(next[i - 1], x, ctx))) continue;
        if (!next.every((x) => spaced(x, next, ctx))) continue;
        fits = true;
        bestObj = Math.max(bestObj, totals(next, ctx.w).objective);
      }
    }
    if (!fits) {
      out.push({
        city,
        reason: {
          kind: "max_leg",
          text: Number.isFinite(ctx.maxLeg) ? `Every place on the route would need a leg over ${ctx.maxLeg.toLocaleString("en-GB")} km.` : "It does not fit around the stops you required.",
        },
      });
      continue;
    }
    const delta = bestObj - base;
    out.push({ city, reason: { kind: "objective", text: `Taking it instead of a stop scores ${Math.abs(delta).toFixed(1)} points ${delta < 0 ? "less" : "more"} once distance is counted.`, delta } });
  }
  return out;
}
