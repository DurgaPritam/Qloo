import "server-only";

import {
  cacheKey,
  createDefaultCache,
  normalizeParams,
  type CacheStore,
  type QlooParams,
} from "./cache";
import { BudgetExceededError, NotFoundError, RateLimitedError, UpstreamError } from "./errors";

export const QLOO_TIMEOUT_MS = 8_000;
/** Heatmaps for big fanbases (Taylor Swift in the US) take longer than 8 s on a cold cache. */
export const QLOO_HEATMAP_TIMEOUT_MS = 20_000;
export const QLOO_RUN_BUDGET = 25;
export const QLOO_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

const RETRY_BASE_MS = 500;
const RETRY_MAX_MS = 4_000;
const MAX_TRACKED_RUNS = 1_000;

/** What the UI shows for a call. Never contains the API key. */
export interface QlooCallMeta {
  endpoint: string;
  params: Record<string, string>;
  cached: boolean;
  ms: number;
  /** Qloo's x-month-ratelimit-remaining after this call; absent on cache hits. */
  quotaRemaining?: number;
}

/**
 * The last monthly quota Qloo reported to this process, for /api/health. On globalThis because
 * route handlers are separate bundles with their own module copies.
 */
const shared = globalThis as typeof globalThis & { __takeoverQuota?: { remaining?: number; limit?: number; at?: number } };
export const lastQuota = (shared.__takeoverQuota ??= {});

export interface QlooResult<T> {
  data: T;
  meta: QlooCallMeta;
}

export interface QlooCallOptions {
  runId: string;
}

export interface QlooClientDeps {
  fetch?: typeof fetch;
  cache?: CacheStore;
  env?: () => { QLOO_API_KEY?: string; QLOO_BASE_URL?: string };
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  budget?: number;
  /** Cache lifetime for responses; 0 = no expiry (warm cache). Default 7 days. */
  ttlSeconds?: number;
}

export interface QlooClient {
  get<T>(path: string, params: QlooParams, options: QlooCallOptions): Promise<QlooResult<T>>;
  /** Uncached calls made so far by a run. */
  callCount(runId: string): number;
  /** Forget a finished run's counter. */
  endRun(runId: string): void;
}

export function createQlooClient(deps: QlooClientDeps = {}): QlooClient {
  const doFetch = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const cache = deps.cache ?? createDefaultCache();
  const readEnv = deps.env ?? (() => process.env);
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = deps.now ?? (() => performance.now());
  const timeoutMs = deps.timeoutMs ?? QLOO_TIMEOUT_MS;
  const budget = deps.budget ?? QLOO_RUN_BUDGET;
  const ttlSeconds = deps.ttlSeconds ?? QLOO_CACHE_TTL_SECONDS;

  const runCalls = new Map<string, number>();

  function chargeRun(runId: string, endpoint: string, params: Record<string, string>) {
    const used = runCalls.get(runId) ?? 0;
    if (used >= budget) {
      throw new BudgetExceededError({ endpoint, params, runId, limit: budget });
    }
    runCalls.delete(runId);
    runCalls.set(runId, used + 1);
    if (runCalls.size > MAX_TRACKED_RUNS) {
      const oldest = runCalls.keys().next().value;
      if (oldest !== undefined) runCalls.delete(oldest);
    }
  }

  async function attempt(req: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const ms = req.fail.params["filter.type"] === "urn:heatmap" ? Math.max(timeoutMs, QLOO_HEATMAP_TIMEOUT_MS) : timeoutMs;
    const timer = setTimeout(() => controller.abort(), ms);
    try {
      const res = await doFetch(req.url, {
        headers: { "X-Api-Key": req.apiKey, Accept: "application/json" },
        signal: controller.signal,
      });
      const remaining = Number(res.headers.get("x-month-ratelimit-remaining"));
      const limit = Number(res.headers.get("x-month-ratelimit-limit"));
      if (Number.isFinite(remaining) && res.headers.has("x-month-ratelimit-remaining")) {
        Object.assign(lastQuota, { remaining, limit: Number.isFinite(limit) ? limit : undefined, at: Date.now() });
      }
      return {
        status: res.status,
        // Qloo sends x-second-ratelimit-reset (seconds) on per-second limits.
        retryAfterMs:
          parseRetryAfter(res.headers.get("retry-after")) ?? parseRetryAfter(res.headers.get("x-second-ratelimit-reset")),
        quotaRemaining: res.headers.has("x-month-ratelimit-remaining") ? remaining : undefined,
        body: await res.text(),
      };
    } catch (err) {
      const message = controller.signal.aborted
        ? `Qloo ${req.fail.endpoint} timed out after ${ms}ms`
        : `Qloo ${req.fail.endpoint} request failed`;
      throw new UpstreamError({ ...req.fail, message, cause: redactError(err, req.redact) });
    } finally {
      clearTimeout(timer);
    }
  }

  /** One attempt, plus one retry with backoff on 429/5xx. */
  async function send<T>(req: HttpRequest): Promise<{ data: T; quotaRemaining?: number }> {
    let res = await attempt(req);
    if (isRetryable(res.status)) {
      const jitter = RETRY_BASE_MS + Math.random() * RETRY_BASE_MS;
      await sleep(Math.min(res.retryAfterMs ?? jitter, RETRY_MAX_MS));
      res = await attempt(req);
    }
    return { data: parseResponse<T>(res, req), quotaRemaining: res.quotaRemaining };
  }

  async function get<T>(
    path: string,
    params: QlooParams,
    { runId }: QlooCallOptions,
  ): Promise<QlooResult<T>> {
    const started = now();
    const env = readEnv();
    // Trimmed: a stray space after "=" in an env file must not break the URL or the header.
    const apiKey = env.QLOO_API_KEY?.trim();
    const baseUrl = env.QLOO_BASE_URL?.trim();
    const redact = (text: string) => (apiKey ? text.split(apiKey).join("[redacted]") : text);

    const endpoint = path;
    const clean = Object.fromEntries(
      Object.entries(normalizeParams(params)).map(([k, v]) => [k, redact(v)]),
    );
    const key = cacheKey(path, params);
    const meta = (cached: boolean): QlooCallMeta => ({
      endpoint,
      params: clean,
      cached,
      ms: Math.round(now() - started),
    });

    const hit = await cache.get<T>(key);
    if (hit !== null) return { data: hit, meta: meta(true) };

    if (!apiKey) throw new Error("QLOO_API_KEY is not set");
    if (!baseUrl) throw new Error("QLOO_BASE_URL is not set");

    chargeRun(runId, endpoint, clean);

    const url = buildUrl(baseUrl, path, params);
    const { data, quotaRemaining } = await send<T>({ url, apiKey, redact, fail: { endpoint, params: clean } });
    await cache.set(key, data, ttlSeconds);
    return { data, meta: { ...meta(false), quotaRemaining } };
  }

  return {
    get,
    callCount: (runId) => runCalls.get(runId) ?? 0,
    endRun: (runId) => {
      runCalls.delete(runId);
    },
  };
}

interface HttpRequest {
  url: string;
  apiKey: string;
  redact: (text: string) => string;
  fail: { endpoint: string; params: Record<string, string> };
}

interface HttpResponse {
  status: number;
  retryAfterMs?: number;
  quotaRemaining?: number;
  body: string;
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function buildUrl(baseUrl: string, path: string, params: QlooParams): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const query = new URLSearchParams(normalizeParams(params)).toString();
  return query ? `${base}${path}?${query}` : `${base}${path}`;
}

function parseResponse<T>({ status, retryAfterMs, body }: HttpResponse, req: HttpRequest): T {
  const { fail, redact } = req;
  if (status >= 200 && status < 300) {
    try {
      return JSON.parse(body) as T;
    } catch {
      throw new UpstreamError({ ...fail, status, message: `Qloo ${fail.endpoint} returned invalid JSON` });
    }
  }
  if (status === 404) throw new NotFoundError(fail);
  if (status === 429) throw new RateLimitedError({ ...fail, retryAfterMs });
  throw new UpstreamError({
    ...fail,
    status,
    message: redact(`Qloo ${fail.endpoint} returned ${status}: ${body.slice(0, 200)}`),
  });
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function redactError(err: unknown, redact: (text: string) => string): Error {
  if (err instanceof Error) {
    const safe = new Error(redact(err.message));
    safe.name = err.name;
    return safe;
  }
  return new Error("unknown error");
}

let defaultClient: QlooClient | undefined;

export function getQlooClient(): QlooClient {
  defaultClient ??= createQlooClient();
  return defaultClient;
}

/** The single entry point for Qloo calls: cached, timed out, retried once and budgeted per run. */
export function qlooGet<T>(
  path: string,
  params: QlooParams,
  options: QlooCallOptions,
): Promise<QlooResult<T>> {
  return getQlooClient().get<T>(path, params, options);
}
