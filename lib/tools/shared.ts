import "server-only";

import { CITIES } from "@/lib/engine/data";
import { classifyMatches } from "@/lib/engine/match";
import { metroCities } from "@/lib/engine/metro";
import type { Category, City, Entity } from "@/lib/engine/types";
import type { QlooCallOptions } from "@/lib/qloo/client";
import type { QlooSource, SourceMeta } from "@/lib/qloo/source";

export type CallView = Pick<SourceMeta, "endpoint" | "params" | "cached" | "ms">;

export const view = (meta: SourceMeta): CallView => ({ endpoint: meta.endpoint, params: meta.params, cached: meta.cached, ms: meta.ms });

let metro: City[] | undefined;
/** GeoNames cities folded into metros, as the takeover's city step uses. */
export function metroPool(): City[] {
  metro ??= metroCities(CITIES);
  return metro;
}

export interface Choice {
  entityId: string;
  name: string;
  category: Category;
  detail?: string;
}

/** The typed name as one entity, or the choices to show when it is ambiguous or misspelt. */
export type Resolved =
  | { kind: "resolved"; entity: Entity }
  | { kind: "choose"; question: string; choices: Choice[] }
  | { kind: "none" };

export async function resolveEntity(
  query: string,
  categories: readonly Category[] | undefined,
  entityId: string | undefined,
  source: QlooSource,
  opts: QlooCallOptions,
  calls: CallView[],
): Promise<Resolved> {
  const res = await source.searchEntities(query, categories, opts);
  calls.push(view(res.meta));
  const picked = entityId && res.data.find((e) => e.id === entityId);
  if (picked) return { kind: "resolved", entity: picked };
  const match = classifyMatches(query, res.data);
  if (match.kind === "resolved") return { kind: "resolved", entity: match.entity };
  if (match.kind === "none") return { kind: "none" };
  const choices = match.options.map(({ entity }) => ({
    entityId: entity.id,
    name: entity.name,
    category: entity.category,
    detail: (entity.description ?? entity.disambiguation)?.slice(0, 110),
  }));
  const question =
    match.kind === "ambiguous"
      ? `Found ${choices.length} matches for “${query}”, which one?`
      : `No match for “${query}”, did you mean ${choices.map((c) => c.name).join(" or ")}?`;
  return { kind: "choose", question, choices };
}

/** For logs: the error's kind and message, never params or keys (the client already redacts). */
export function describeFailure(err: unknown): string {
  if (!(err instanceof Error)) return "unknown";
  const kind = (err as { kind?: string }).kind;
  return `${kind ?? err.constructor.name}: ${err.message.slice(0, 160)}`;
}
