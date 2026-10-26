import "server-only";

import {
  FinishReason,
  FunctionCallingConfigMode,
  type GoogleGenAI,
  ThinkingLevel,
  type Content,
  type FunctionDeclaration,
  type GenerateContentConfig,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";

import type { ChatOptions, ChatTurn, Completion, LLMProvider, ToolChat, ToolResult, ToolSpec, Usage } from "./types";

type Client = Pick<GoogleGenAI, "models">;

/** Finish reasons where Gemini withheld an answer; treated like a refusal. */
const BLOCKED = new Set<string>([
  FinishReason.SAFETY,
  FinishReason.RECITATION,
  FinishReason.BLOCKLIST,
  FinishReason.PROHIBITED_CONTENT,
  FinishReason.SPII,
]);

/** Tool specs as Gemini function declarations. Tools without inputs get no schema. */
export function geminiDeclarations(tools: readonly ToolSpec[]): FunctionDeclaration[] {
  return tools.map(({ name, description, parameters }) => {
    const props = parameters.properties ?? {};
    if (Object.keys(props).length === 0) return { name, description };
    return { name, description, parametersJsonSchema: withoutAdditional(parameters) };
  });
}

/** Drops `additionalProperties`, which Gemini's schema subset does not need; unknown inputs are ignored by the tools. */
function withoutAdditional(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(withoutAdditional);
  if (!schema || typeof schema !== "object") return schema;
  return Object.fromEntries(
    Object.entries(schema)
      .filter(([k]) => k !== "additionalProperties")
      .map(([k, v]) => [k, withoutAdditional(v)]),
  );
}

export function geminiUsage(res: Pick<GenerateContentResponse, "usageMetadata">): Usage {
  const u = res.usageMetadata ?? {};
  return {
    input: (u.promptTokenCount ?? 0) + (u.toolUsePromptTokenCount ?? 0),
    // Thinking tokens are billed as output.
    output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
  };
}

function visibleText(parts: readonly Part[]): string {
  return parts
    .filter((p) => typeof p.text === "string" && !p.thought)
    .map((p) => p.text)
    .join(" ")
    .trim();
}

/** Overload and rate-limit answers: worth one retry, then the fallback model. */
const RETRYABLE = new Set([429, 500, 503, 504]);
const RETRY_MS = 1000;

/** "retry": overloaded, try this model once more; "next": timed out, go straight to the next model. */
function recovery(err: unknown): "retry" | "next" | null {
  const e = err as { status?: unknown; name?: unknown } | null;
  if (typeof e?.status === "number" && RETRYABLE.has(e.status)) return "retry";
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "next";
  return null;
}

export interface GeminiOptions {
  /** Tried in order when the main model is overloaded; only before a chat has started. */
  fallbacks?: readonly string[];
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Tries each model in turn, retrying each once on an overload or rate-limit error. A timed-out
 * call (the client's per-call timeout) moves straight to the next model.
 */
async function generate(
  client: Client,
  models: readonly string[],
  params: Omit<GenerateContentParameters, "model">,
  sleep: (ms: number) => Promise<void>,
): Promise<{ res: GenerateContentResponse; model: string }> {
  let last: unknown;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const started = Date.now();
      try {
        const res = await client.models.generateContent({ ...params, model });
        console.info(`[llm] ${model} answered in ${Date.now() - started} ms`);
        return { res, model };
      } catch (err) {
        const how = recovery(err);
        const status = (err as { status?: unknown } | null)?.status ?? (err as Error | null)?.name ?? "error";
        console.warn(`[llm] ${model} failed after ${Date.now() - started} ms (${String(status)})`);
        if (!how) throw err;
        last = err;
        if (how === "next") break;
        if (attempt === 0) await sleep(RETRY_MS);
      }
    }
  }
  throw last;
}

function refused(res: GenerateContentResponse): boolean {
  if (res.promptFeedback?.blockReason) return true;
  const reason = res.candidates?.[0]?.finishReason;
  return reason !== undefined && BLOCKED.has(reason);
}

class GeminiChat implements ToolChat {
  private readonly contents: Content[] = [];
  /** Ids we made up because the model sent none; never sent back. */
  private readonly localIds = new Set<string>();
  private turn = 0;
  /** Set by the first answer: thought signatures belong to the model that wrote them. */
  private model: string | null = null;

  constructor(
    private readonly client: Client,
    private readonly models: readonly string[],
    private readonly opts: ChatOptions,
    private readonly sleep: (ms: number) => Promise<void>,
  ) {}

  async send(input: string | readonly ToolResult[]): Promise<ChatTurn> {
    this.turn++;
    this.contents.push(
      typeof input === "string"
        ? { role: "user", parts: [{ text: input }] }
        : { role: "user", parts: input.map((r) => this.response(r)) },
    );

    const config: GenerateContentConfig = {
      systemInstruction: this.opts.system,
      maxOutputTokens: this.opts.maxOutputTokens,
      tools: [{ functionDeclarations: geminiDeclarations(this.opts.tools) }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
      thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
    };
    const { res, model } = await generate(
      this.client,
      this.model ? [this.model] : this.models,
      { contents: [...this.contents], config },
      this.sleep,
    );
    this.model = model;

    const content = res.candidates?.[0]?.content;
    // The model turn goes back unchanged: Gemini needs its thought signatures on the next call.
    if (content?.parts?.length) this.contents.push({ ...content, role: "model" });
    const parts = content?.parts ?? [];

    const calls = parts.flatMap((p, i) => {
      const fc = p.functionCall;
      if (!fc?.name) return [];
      const id = fc.id ?? `gemini_${this.turn}_${i}`;
      if (!fc.id) this.localIds.add(id);
      const args = fc.args && typeof fc.args === "object" ? fc.args : {};
      return [{ id, name: fc.name, input: args as Record<string, unknown> }];
    });

    let stopReason: ChatTurn["stopReason"] = "other";
    const finish = res.candidates?.[0]?.finishReason;
    if (refused(res)) stopReason = "refusal";
    else if (calls.length) stopReason = "tool_use";
    else if (finish === undefined || finish === FinishReason.STOP) stopReason = "end_turn";

    return { stopReason, text: visibleText(parts), calls, usage: geminiUsage(res), model };
  }

  private response(r: ToolResult): Part {
    const response = r.isError ? { error: r.content } : { output: r.content };
    const id = this.localIds.has(r.id) ? undefined : r.id;
    return { functionResponse: { ...(id ? { id } : {}), name: r.name, response } };
  }
}

/** Gemini through the official Google Gen AI SDK. */
export class GeminiProvider implements LLMProvider {
  readonly name = "gemini";
  private client?: Client;
  private readonly models: readonly string[];
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    readonly model: string,
    private readonly makeClient: () => Client,
    opts: GeminiOptions = {},
  ) {
    this.models = [...new Set([model, ...(opts.fallbacks ?? [])])];
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private get api(): Client {
    this.client ??= this.makeClient();
    return this.client;
  }

  chat(opts: ChatOptions): ToolChat {
    return new GeminiChat(this.api, this.models, opts, this.sleep);
  }

  async complete(prompt: string, { maxOutputTokens }: { maxOutputTokens: number }): Promise<Completion> {
    const { res, model } = await generate(
      this.api,
      this.models,
      {
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { maxOutputTokens, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      },
      this.sleep,
    );
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    return { text: visibleText(parts), refused: refused(res), usage: geminiUsage(res), model };
  }
}
