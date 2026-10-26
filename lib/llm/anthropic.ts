import "server-only";

import Anthropic from "@anthropic-ai/sdk";

import type { ChatOptions, ChatTurn, Completion, LLMProvider, ToolChat, ToolResult, Usage } from "./types";

type Client = Pick<Anthropic, "beta">;

export const ANTHROPIC_MODEL = "claude-sonnet-5-5";

function anthropicUsage(u: Anthropic.Beta.BetaUsage | undefined): Usage {
  if (!u) return { input: 0, output: 0 };
  return {
    input: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
    output: u.output_tokens,
  };
}

class AnthropicChat implements ToolChat {
  private readonly messages: Anthropic.Beta.BetaMessageParam[] = [];

  constructor(
    private readonly client: Client,
    private readonly opts: ChatOptions,
  ) {}

  async send(input: string | readonly ToolResult[]): Promise<ChatTurn> {
    this.messages.push({
      role: "user",
      content:
        typeof input === "string"
          ? input
          : input.map((r) => ({
              type: "tool_result" as const,
              tool_use_id: r.id,
              content: JSON.stringify(r.content),
              is_error: r.isError,
            })),
    });

    const res = await this.client.beta.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: this.opts.maxOutputTokens,
      system: this.opts.system,
      tools: this.opts.tools.map(({ name, description, parameters }) => ({ name, description, input_schema: parameters })),
      messages: [...this.messages],
      cache_control: { type: "ephemeral" },
      output_config: { effort: "medium" },
      // Re-run on a policy decline with the model Anthropic routes to, inside the same call.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    this.messages.push({ role: "assistant", content: res.content });

    const calls: ChatTurn["calls"] = [];
    const text: string[] = [];
    for (const block of res.content) {
      if (block.type === "tool_use") {
        const args = block.input && typeof block.input === "object" ? block.input : {};
        calls.push({ id: block.id, name: block.name, input: args as Record<string, unknown> });
      } else if (block.type === "text") {
        text.push(block.text);
      }
    }
    let stopReason: ChatTurn["stopReason"] = "other";
    if (res.stop_reason === "tool_use" || res.stop_reason === "end_turn" || res.stop_reason === "refusal") {
      stopReason = res.stop_reason;
    }
    return { stopReason, text: text.join(" "), calls, usage: anthropicUsage(res.usage), model: ANTHROPIC_MODEL };
  }
}

/** Claude through the Anthropic SDK. */
export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly model = ANTHROPIC_MODEL;
  private client?: Client;

  constructor(private readonly makeClient: () => Client = () => new Anthropic()) {}

  private get api(): Client {
    this.client ??= this.makeClient();
    return this.client;
  }

  chat(opts: ChatOptions): ToolChat {
    return new AnthropicChat(this.api, opts);
  }

  async complete(prompt: string, { maxOutputTokens }: { maxOutputTokens: number }): Promise<Completion> {
    const res = await this.api.beta.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: maxOutputTokens,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: prompt }],
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    return { text, refused: res.stop_reason === "refusal", usage: anthropicUsage(res.usage) };
  }
}
