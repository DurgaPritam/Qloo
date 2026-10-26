export type ProviderName = "gemini" | "anthropic";

/** A JSON-schema object for a tool's input; converted per provider. */
export interface JsonSchemaObject {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  /** The id of the call this answers. */
  id: string;
  name: string;
  content: unknown;
  isError: boolean;
}

/** Tokens billed for one call, from the provider's usage metadata. */
export interface Usage {
  input: number;
  output: number;
}

export interface ChatTurn {
  stopReason: "tool_use" | "end_turn" | "refusal" | "other";
  /** Any text the model wrote alongside its calls. */
  text: string;
  calls: ToolCall[];
  usage: Usage;
  /** The model that answered, when it can differ from the provider's main model. */
  model?: string;
}

/** One conversation with tools. The provider keeps its own transcript, unchanged between turns. */
export interface ToolChat {
  /** A user message to start, then the results for the previous turn's calls. */
  send(input: string | readonly ToolResult[]): Promise<ChatTurn>;
}

export interface Completion {
  text: string;
  refused: boolean;
  usage: Usage;
  model?: string;
}

export interface ChatOptions {
  system: string;
  tools: readonly ToolSpec[];
  maxOutputTokens: number;
}

export interface LLMProvider {
  readonly name: ProviderName;
  readonly model: string;
  chat(opts: ChatOptions): ToolChat;
  /** Plain completion: no tools, no system prompt. */
  complete(prompt: string, opts: { maxOutputTokens: number }): Promise<Completion>;
}
