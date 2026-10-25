import "server-only";

import {
  FinishReason,
  FunctionCallingConfigMode,
  type GoogleGenAI,
  ThinkingLevel,
  type Content,
  type FunctionDeclaration,
  type GenerateContentConfig,
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

  constructor(
    private readonly client: Client,
    private readonly model: string,
    private readonly opts: ChatOptions,
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
    const res = await this.client.models.generateContent({ model: this.model, contents: [...this.contents], config });

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

    return { stopReason, text: visibleText(parts), calls, usage: geminiUsage(res) };
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

  constructor(
    readonly model: string,
    private readonly makeClient: () => Client,
  ) {}

  private get api(): Client {
    this.client ??= this.makeClient();
    return this.client;
  }

  chat(opts: ChatOptions): ToolChat {
    return new GeminiChat(this.api, this.model, opts);
  }

  async complete(prompt: string, { maxOutputTokens }: { maxOutputTokens: number }): Promise<Completion> {
    const res = await this.api.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { maxOutputTokens, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    const parts = res.candidates?.[0]?.content?.parts ?? [];
    return { text: visibleText(parts), refused: refused(res), usage: geminiUsage(res) };
  }
}
