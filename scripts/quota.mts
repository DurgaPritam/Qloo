/**
 * Prints Qloo's monthly quota left, from one uncached search call (a random query, so the cache
 * cannot answer). Local diagnostics only; never prints the key.
 *
 *   npx tsx --conditions=react-server scripts/quota.mts
 */
import path from "node:path";

import { lastQuota } from "@/lib/qloo/client";
import { getQlooSource } from "../lib/qloo/source";

process.loadEnvFile(path.resolve(import.meta.dirname, "..", ".env.local"));
process.env.TAKEOVER_MOCK = "";

const source = getQlooSource();
await source.searchEntities(`quota-probe-${crypto.randomUUID().slice(0, 8)}`, ["artist"], { runId: `quota-${Date.now()}` });
console.log(`Qloo monthly quota: ${lastQuota.remaining ?? "?"} left of ${lastQuota.limit ?? "?"} (this probe used 1 call)`);
