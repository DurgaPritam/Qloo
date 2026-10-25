import "server-only";

import type { Redis } from "@upstash/redis";

import { getRedis } from "@/lib/server/redis";

import type { ChatOptions, LLMProvider, ToolChat, Usage } from "./types";

export const DEFAULT_DAILY_TOKENS = 2_000_000;
const KEY_TTL_SECONDS = 2 * 24 * 60 * 60;

export function dailyTokenLimit(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_DAILY_TOKENS;
}

export class TokenBudgetExceededError extends Error {
  readonly name = "TokenBudgetExceededError";
  constructor(readonly limit: number) {
    super(`The daily budget of ${limit} model tokens is used up.`);
  }
}

/** Used when Redis is not configured or down; shared by every request in this process. */
const memoryUsed = new Map<string, number>();

/**
 * Model tokens (input + output) spent today, across all live runs and LLM-only answers. Kept in
 * Redis so every serverless instance sees the same total; the day is UTC.
 */
export class TokenBudget {
  constructor(
    readonly limit: number,
    private readonly redis: Pick<Redis, "get" | "incrby" | "expire"> | null,
    private readonly now: () => number = Date.now,
    private readonly memory: Map<string, number> = memoryUsed,
  ) {}

  private key(): string {
    return `takeover:llm:tokens:v1:${new Date(this.now()).toISOString().slice(0, 10)}`;
  }

  /** When the count starts again: the next UTC midnight. */
  resetsAt(): number {
    const d = new Date(this.now());
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
  }

  async used(): Promise<number> {
    const key = this.key();
    if (this.redis) {
      try {
        return Number((await this.redis.get<number>(key)) ?? 0);
      } catch {
        // Redis down: fall back to this process's count.
      }
    }
    return this.memory.get(key) ?? 0;
  }

  async exceeded(): Promise<boolean> {
    return (await this.used()) >= this.limit;
  }

  async add(usage: Usage): Promise<void> {
    const tokens = Math.max(0, Math.round(usage.input + usage.output));
    if (!tokens) return;
    const key = this.key();
    this.memory.set(key, (this.memory.get(key) ?? 0) + tokens);
    if (this.memory.size > 3) this.memory.delete(this.memory.keys().next().value!);
    if (!this.redis) return;
    try {
      const total = await this.redis.incrby(key, tokens);
      if (total === tokens) await this.redis.expire(key, KEY_TTL_SECONDS);
    } catch {
      console.error("[llm] could not record token use in Redis; counting in memory.");
    }
  }
}

export function getTokenBudget(env: Record<string, string | undefined> = process.env): TokenBudget {
  return new TokenBudget(dailyTokenLimit(env.LLM_DAILY_TOKEN_BUDGET), getRedis(env));
}

/**
 * Wraps a provider so every call is refused once today's budget is spent, and every call's
 * usage is counted.
 */
export function withTokenBudget(provider: LLMProvider, budget: TokenBudget): LLMProvider {
  const guard = async () => {
    if (await budget.exceeded()) throw new TokenBudgetExceededError(budget.limit);
  };
  return {
    name: provider.name,
    model: provider.model,
    chat(opts: ChatOptions): ToolChat {
      const chat = provider.chat(opts);
      return {
        async send(input) {
          await guard();
          const turn = await chat.send(input);
          await budget.add(turn.usage);
          return turn;
        },
      };
    },
    async complete(prompt, opts) {
      await guard();
      const out = await provider.complete(prompt, opts);
      await budget.add(out.usage);
      return out;
    },
  };
}
