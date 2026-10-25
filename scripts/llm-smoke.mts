/**
 * One small call to the configured model, to check the key, model id and thinking settings.
 * Prints the model, the stop reason and the token use; never the key. Local diagnostics only.
 *
 *   npx tsx --conditions=react-server scripts/llm-smoke.mts
 */
import path from "node:path";

import { createProvider, providerStatus } from "../lib/llm";

process.loadEnvFile(path.resolve(import.meta.dirname, "..", ".env.local"));

const status = providerStatus();
const provider = createProvider();
if (!provider) {
  console.error(`No usable provider: ${status.ok ? `${status.provider} key is not set` : status.reason}`);
  process.exit(1);
}
const started = Date.now();
const chat = provider.chat({
  system: "Call the tool named ping exactly once.",
  tools: [{ name: "ping", description: "Answer the check.", parameters: { type: "object", properties: { word: { type: "string" } } } }],
  maxOutputTokens: 1024,
});
const turn = await chat.send("Run the check.");
const done = await chat.send(turn.calls.map((c) => ({ id: c.id, name: c.name, content: { ok: true }, isError: false })));
const plain = await provider.complete("Reply with the single word: ready.", { maxOutputTokens: 256 });
console.log(
  JSON.stringify({
    provider: provider.name,
    model: provider.model,
    toolTurn: { stop: turn.stopReason, calls: turn.calls.map((c) => c.name), usage: turn.usage },
    afterResult: { stop: done.stopReason, text: done.text.slice(0, 80), usage: done.usage },
    completion: { refused: plain.refused, text: plain.text.slice(0, 40), usage: plain.usage },
    ms: Date.now() - started,
  }, null, 2),
);
