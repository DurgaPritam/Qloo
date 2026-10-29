import "server-only";

import type { Plan } from "@/lib/agent/types";
import { InputError } from "@/lib/db/scoped";
import type { CityScore, Entity } from "@/lib/engine/types";
import { enqueue } from "@/lib/jobs/queue";
import { matchBrand } from "@/lib/tools/brand";
import { exploreCities } from "@/lib/tools/cities";
import { checkOverlap } from "@/lib/tools/overlap";
import type { CallView, Choice } from "@/lib/tools/shared";
import { BOOKING_KINDS, bookFor, type BookingKind } from "@/lib/tools/venue";

import type { ApiAnswer, ApiContext } from "./v1";

/**
 * The public API's endpoints, as {data, evidence}. Figures are the engine's (0–1 or 0–100, stated
 * per field); evidence carries the Qloo requests behind them and how each figure is computed.
 */
const entity = (e: Pick<Entity, "id" | "name" | "category">) => ({ id: e.id, name: e.name, category: e.category });
const requests = (calls: readonly Pick<CallView, "endpoint" | "params">[]) => calls.map((c) => ({ endpoint: c.endpoint, params: c.params }));
const city = (c: CityScore) => ({ id: c.city.id, name: c.city.name, country: c.city.country, score: c.combined, rank: c.rank, populationRank: c.populationRank, confidence: c.confidence });
const choose = (r: { question?: string; choices?: Choice[] }, calls: CallView[]): ApiAnswer => ({
  data: { status: "choose", question: r.question ?? "Which one?", choices: (r.choices ?? []).map((c) => ({ entityId: c.entityId, name: c.name, category: c.category, detail: c.detail ?? null })) },
  evidence: { requests: requests(calls), note: "Send the request again with the chosen entityId." },
});
const none = (q: string, calls: CallView[]): ApiAnswer => ({ data: { status: "none", query: q }, evidence: { requests: requests(calls) }, status: 404 });
const opts = (c: ApiContext) => ({ runId: c.runId, scope: c.scope });
const str = (v: string | null, max = 100) => (v ?? "").trim().slice(0, max);

/** GET /api/v1/overlap?a=&b=[&aId=&bId=] */
export async function overlap(c: ApiContext, q: URLSearchParams): Promise<ApiAnswer> {
  const a = str(q.get("a"));
  const b = str(q.get("b"));
  if (!a || !b) throw new InputError("Give two names: ?a=…&b=…");
  const r = await checkOverlap(a, b, { a: str(q.get("aId"), 200) || undefined, b: str(q.get("bId"), 200) || undefined }, c.source, opts(c));
  if (r.status === "choose") return { ...choose(r, r.calls), data: { ...(choose(r, r.calls).data as object), side: r.side } };
  if (r.status === "none") return none(r.query, r.calls);
  return {
    data: { status: "done", a: entity(r.a), b: entity(r.b), bAmongA: r.bAmongA, aAmongB: r.aAmongB, level: r.level, market: r.market.code, cities: r.cities.slice(0, 10).map(city) },
    evidence: {
      requests: requests(r.calls),
      method: {
        bAmongA: "Qloo affinity (0–1) of b among a's fans (insights, filter.results.entities).",
        aAmongB: "Qloo affinity (0–1) of a among b's fans.",
        cities: "score = √(a's heat × b's heat), each scaled to its hottest city in the market (0–1).",
      },
      cities: r.cities.slice(0, 10).map((x) => ({ id: x.city.id, heatCellsA: x.evidence.cellsA, heatCellsB: x.evidence.cellsB })),
    },
  };
}

/** GET /api/v1/fanbases/cities?q=[&entityId=] */
export async function fanbaseCities(c: ApiContext, q: URLSearchParams): Promise<ApiAnswer> {
  const name = str(q.get("q"));
  if (!name) throw new InputError("Name a fanbase: ?q=…");
  const r = await exploreCities(name, str(q.get("entityId"), 200) || undefined, c.source, opts(c));
  if (r.status !== "done") return r.status === "choose" ? choose(r, r.calls) : none(name, r.calls);
  return {
    data: { status: "done", fanbase: entity(r.fanbase), markets: r.markets.map((m) => ({ market: m.market.code, home: m.home, cities: m.cities.slice(0, 10).map(city), error: m.error ?? null })) },
    evidence: { requests: requests(r.calls), method: { score: "The fanbase's heat near each city (Qloo heatmap), scaled to its hottest city in the market (0–1)." } },
  };
}

/** GET /api/v1/venues?city=[&kinds=music,comedy,podcast,brand] */
export async function venues(c: ApiContext, q: URLSearchParams): Promise<ApiAnswer> {
  const where = str(q.get("city"));
  if (!where) throw new InputError("Name a city: ?city=…");
  const asked = (q.get("kinds") ?? "music,comedy").split(",").map((k) => k.trim()).filter((k): k is BookingKind => (BOOKING_KINDS as string[]).includes(k));
  const r = await bookFor(where, asked.length ? asked : ["music"], c.source, opts(c));
  if (!r) return { data: { status: "none", city: where }, evidence: { requests: [] }, status: 404 };
  return {
    data: {
      status: "done",
      city: { id: r.city.id, name: r.city.name, country: r.city.country },
      lists: r.lists.map((l) => ({ kind: l.kind, label: l.label, picks: l.picks.map((p) => ({ ...entity(p.entity), affinity: p.entity.affinity, rank: p.rank })), error: l.error ?? null })),
      toConfirm: "Availability, fees and dates are to confirm with the act or venue.",
    },
    evidence: { requests: requests(r.calls), method: { affinity: "Qloo affinity (0–1) among people in the city; rank is Qloo's order after the popularity band." } },
  };
}

/** GET /api/v1/brands/matches?q=[&entityId=] */
export async function brandMatches(c: ApiContext, q: URLSearchParams): Promise<ApiAnswer> {
  const name = str(q.get("q"));
  if (!name) throw new InputError("Name a brand: ?q=…");
  const r = await matchBrand(name, str(q.get("entityId"), 200) || undefined, c.source, opts(c));
  if (r.status !== "done") return r.status === "choose" ? choose(r, r.calls) : none(name, r.calls);
  return {
    data: {
      status: "done",
      brand: entity(r.brand),
      market: r.market.code,
      lists: r.lists.map((l) => ({ category: l.category, label: l.label, picks: l.picks.map((p) => ({ ...entity(p.entity), score: p.score, affinity: p.evidence.affinity })) })),
      cities: r.cities.slice(0, 10).map(city),
      toConfirm: "Reach, fees and availability are to confirm with the brand.",
    },
    evidence: {
      requests: requests(r.calls),
      method: { score: "Engine partner score: affinity relative to its category, with a gentle mainstream discount (0–1).", affinity: "Qloo affinity among the brand's fans (0–1)." },
    },
  };
}

/** POST /api/v1/plans {query, entityId?} → 202 with a job id; the plan runs in the background. */
export async function createPlan(c: ApiContext, body: Record<string, unknown>): Promise<ApiAnswer> {
  const query = typeof body.query === "string" ? body.query.trim().slice(0, 100) : "";
  if (!query) throw new InputError("Send {\"query\": \"a fanbase\"}.");
  const planId = crypto.randomUUID();
  const jobId = await c.repo.jobs.create({ kind: "plan.create", targetId: planId, status: "queued", payload: { query } });
  const entityId = typeof body.entityId === "string" ? body.entityId.slice(0, 200) : undefined;
  await enqueue({ kind: "plan.create", workspaceId: c.ctx.workspaceId, userId: c.ctx.userId, jobId, planId, query, ...(entityId ? { entityId } : {}) }, 0);
  return { data: { status: "queued", jobId, planId, poll: `/api/v1/plans/${planId}` }, evidence: { note: "The plan uses the same agent as the site; poll for its result." }, status: 202 };
}

/** The parts of a plan the API returns: picks with their scores; dates, capacity and prices stay to confirm. */
function planData(p: Plan) {
  const chosen = p.partners?.picks.find((x) => x.pick.entity.id === p.partners?.chosenId)?.pick;
  return {
    status: p.status,
    fanbase: p.fanbase ? entity(p.fanbase) : null,
    format: p.format?.format ?? null,
    partner: chosen ? { ...entity(chosen.entity), score: chosen.score, affinity: chosen.evidence.affinity, confidence: chosen.confidence } : null,
    city: p.city?.chosen ? city(p.city.chosen.pick) : null,
    venue: p.room?.venue ? { name: p.room.venue.pick.place.name, affinity: p.room.venue.pick.evidence.affinity } : null,
    sponsors: (p.room?.sponsors ?? []).map((s) => ({ id: s.pick.brand.id, name: s.pick.brand.name, affinity: s.pick.evidence.affinity })),
    brief: p.brief ?? null,
    outreach: p.outreach ?? null,
    toConfirm: "Capacity, dates and prices are to confirm with the promoter.",
  };
}

/** GET /api/v1/plans/{id} → the job's status, or the plan when it is done. */
export async function getPlan(c: ApiContext, planId: string): Promise<ApiAnswer> {
  if (!/^[0-9a-f-]{36}$/.test(planId)) throw new InputError("Unknown plan id.");
  const row = await c.repo.plans.get(planId);
  if (row) {
    const p = row.result;
    return {
      data: { status: "done", planId, plan: planData(p) },
      evidence: {
        explanations: {
          partner: p.partners?.picks.find((x) => x.pick.entity.id === p.partners?.chosenId)?.explanation ?? null,
          city: p.city?.chosen?.explanation ?? null,
          venue: p.room?.venue?.explanation ?? null,
        },
        notes: p.notes,
        qlooCalls: p.qlooCalls,
      },
    };
  }
  const [job] = await c.repo.jobs.listFor(planId, 1);
  if (!job || job.kind !== "plan.create") return { data: { status: "none", planId }, evidence: {}, status: 404 };
  return { data: { status: job.status, planId, jobId: job.id, note: job.note }, evidence: {} };
}
