import { FORMAT_BY_CATEGORY, PERSON_LIVE_SHOW, type FormatRule } from "./config";
import { isComedian } from "./match";
import type { Entity } from "./types";

/** The event format for a fanbase: by Qloo type, with people split on their Qloo description. */
export function formatFor(entity: Entity): FormatRule {
  if (entity.category === "person" && !isComedian(entity)) return PERSON_LIVE_SHOW;
  return FORMAT_BY_CATEGORY[entity.category];
}
