/** Normalised request params, as sent and as shown in the UI. */
export type QlooErrorParams = Record<string, string>;

export type QlooErrorKind = "not_found" | "rate_limited" | "upstream" | "budget_exceeded";

/** Base class for every failure surfaced by the Qloo client. Messages never contain the API key. */
export class QlooError extends Error {
  readonly kind: QlooErrorKind;
  readonly endpoint: string;
  readonly params: QlooErrorParams;
  readonly status?: number;

  constructor(
    kind: QlooErrorKind,
    message: string,
    details: { endpoint: string; params: QlooErrorParams; status?: number; cause?: unknown },
  ) {
    super(message, { cause: details.cause });
    this.name = new.target.name;
    this.kind = kind;
    this.endpoint = details.endpoint;
    this.params = details.params;
    this.status = details.status;
  }
}

export class NotFoundError extends QlooError {
  constructor(details: { endpoint: string; params: QlooErrorParams; message?: string }) {
    super("not_found", details.message ?? `Qloo ${details.endpoint} returned 404`, {
      ...details,
      status: 404,
    });
  }
}

export class RateLimitedError extends QlooError {
  readonly retryAfterMs?: number;

  constructor(details: { endpoint: string; params: QlooErrorParams; retryAfterMs?: number }) {
    super("rate_limited", `Qloo ${details.endpoint} is rate limited (429)`, {
      ...details,
      status: 429,
    });
    this.retryAfterMs = details.retryAfterMs;
  }
}

/** 5xx, timeouts, network failures and any other unexpected response. */
export class UpstreamError extends QlooError {
  constructor(details: {
    endpoint: string;
    params: QlooErrorParams;
    message: string;
    status?: number;
    cause?: unknown;
  }) {
    super("upstream", details.message, details);
  }
}

export type BudgetLimitName = "run" | "daily" | "workspace" | "job_reserve";

const LIMIT_TEXT: Record<BudgetLimitName, string> = {
  run: "the per-run budget",
  daily: "today's Qloo cap for the whole site",
  workspace: "this workspace's monthly Qloo allowance",
  job_reserve: "the share of today's Qloo cap kept for people using the site",
};

export class BudgetExceededError extends QlooError {
  readonly runId: string;
  readonly limit: number;
  /** Which limit was reached; the message names it. */
  readonly limitName: BudgetLimitName;

  constructor(details: { endpoint: string; params: QlooErrorParams; runId: string; limit: number; limitName?: BudgetLimitName }) {
    const limitName = details.limitName ?? "run";
    super(
      "budget_exceeded",
      limitName === "run"
        ? `Run ${details.runId} exceeded the budget of ${details.limit} Qloo calls`
        : `Reached ${LIMIT_TEXT[limitName]} (${details.limit} calls)`,
      details,
    );
    this.runId = details.runId;
    this.limit = details.limit;
    this.limitName = limitName;
  }
}

export const budgetLimitText = (name: BudgetLimitName) => LIMIT_TEXT[name];
