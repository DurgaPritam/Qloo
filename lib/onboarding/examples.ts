import "server-only";

import { REGISTRY, type FeatureEntry } from "@/lib/features";
import { getQlooSource } from "@/lib/qloo/source";
import { loadRecording, type Recording } from "@/lib/server/replay";

export interface ResolvedExample {
  label: string;
  href: string;
}

/**
 * A feature's example, only when it opens a cached real run: a stored recording of a live Qloo
 * run (recordings refuse sample data). In sample mode, or when the run isn't stored, there is no
 * example and the card links to the feature itself.
 */
export async function exampleFor(f: FeatureEntry, deps: { mock?: boolean; load?: (query: string) => Promise<Recording | null> } = {}): Promise<ResolvedExample | null> {
  if (!f.example) return null;
  const mock = deps.mock ?? getQlooSource().mock;
  if (mock) return null;
  const rec = await (deps.load ?? loadRecording)(f.example.query).catch(() => null);
  if (!rec || rec.plan.mock || rec.events.some((e) => e.event.mock)) return null;
  return { label: f.example.label, href: `/run?q=${encodeURIComponent(f.example.query)}${f.example.hash ? `#${f.example.hash}` : ""}` };
}

/** Every registry example that resolves, by feature id. */
export async function resolvedExamples(deps?: Parameters<typeof exampleFor>[1]): Promise<Record<string, ResolvedExample>> {
  const pairs = await Promise.all(REGISTRY.map(async (f) => [f.id, await exampleFor(f, deps)] as const));
  return Object.fromEntries(pairs.filter((p): p is readonly [string, ResolvedExample] => p[1] !== null));
}
