/**
 * Exercises each fallback on the real API and prints what fired (step 5, docs/test-results.md).
 *
 *   npx tsx --conditions=react-server scripts/fallbacks.mts
 */
import { CITIES } from "@/lib/engine/data";
import { lastQuota } from "@/lib/qloo/client";

import { runOnce } from "./run-real.mjs";

const say = (s: string) => console.log(`\n### ${s}`);

say("Ambiguous name: Mercury");
const mercury = await runOnce("Mercury");
console.log("  choices:", mercury.needsInput?.choices.map((c) => `${c.name} [${c.category}] ${c.detail}`).join(" | "));
const band = mercury.needsInput?.choices.find((c) => c.category === "artist");
if (band) {
  say("Resume with the band (overrides.entityId)");
  await runOnce("Mercury", { entityId: band.entityId });
}

say("No match: asdfgh");
await runOnce("asdfgh");

say("Misspelling: Billie Elish");
const typo = await runOnce("Billie Elish");
console.log("  suggestions:", typo.needsInput?.choices.map((c) => `${c.name}: ${c.detail}`).join(" | "));

say("Partner heat missing earlier: Sabrina Carpenter");
await runOnce("Sabrina Carpenter");

const small = CITIES.find((c) => c.name === "Laredo" && c.country === "US");
if (small) {
  say(`Small city forced (venue fallback): John Mulaney in ${small.name}`);
  await runOnce("John Mulaney", { cityId: small.id });
}
console.log(`\nquota left ${lastQuota.remaining}`);
