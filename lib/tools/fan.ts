import "server-only";

import { cacheLife } from "next/cache";

import { withBudget } from "@/lib/agent/budget";
import { CATEGORY_LABEL } from "@/lib/engine/explain";
import { scorePartners } from "@/lib/engine/partners";
import type { Category, Entity, PartnerPick } from "@/lib/engine/types";
import { FANBASE_CATEGORIES } from "@/lib/qloo/api";
import { getQlooSource } from "@/lib/qloo/source";

import { audienceProfiles, type AudienceProfile } from "./audience";
import { describeFailure, resolveEntity, view, type CallView, type Choice } from "./shared";

/** What else the fans love, one row per category. */
const TASTE: Category[] = ["artist", "tv_show", "movie", "podcast", "brand", "book"];

export interface TasteRow {
  category: Category;
  label: string;
  picks: PartnerPick[];
}

export type FanResult =
  | { status: "choose"; question: string; choices: Choice[]; mock: boolean }
  | { status: "none"; mock: boolean }
  | {
      status: "done";
      fanbase: Entity;
      audience: AudienceProfile | null;
      tastes: TasteRow[];
      /** One sentence built by code from the data above. */
      intro: string;
      calls: CallView[];
      mock: boolean;
    };

const list = (names: string[]) => (names.length < 2 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

export function introFor(name: string, audience: AudienceProfile | null, tastes: TasteRow[]): string {
  const parts: string[] = [];
  if (audience) {
    const s = audience.summary;
    const age = s.skewsTo.length ? `most often ${s.skewsTo.slice(0, 2).join(" or ")}` : "";
    const gender = s.gender === "balanced" ? "" : `skews ${s.gender}`;
    const who = [age, gender].filter(Boolean).join(", ");
    if (who) parts.push(`The ${name} fan is ${who}.`);
  }
  const loves = tastes.flatMap((t) => (t.picks[0] ? [t.picks[0].entity.name] : [])).slice(0, 3);
  if (loves.length) parts.push(`They over-index on ${list(loves)}.`);
  return parts.join(" ") || `What Qloo knows about ${name} fans.`;
}

/**
 * Meet the fan: demographics plus the top three over-indexed entities in six categories, scored
 * like takeover partners. Cached for a day per name, so shared links and their preview images
 * make no new Qloo calls. Up to 8 calls on a miss.
 */
export async function fanPersona(query: string, entityId?: string): Promise<FanResult> {
  "use cache";
  cacheLife("days");
  const runId = `fan-${query}-${entityId ?? ""}`;
  const source = withBudget(getQlooSource(), runId, 8);
  const opts = { runId };
  const calls: CallView[] = [];
  const resolved = await resolveEntity(query, FANBASE_CATEGORIES, entityId, source, opts, calls);
  if (resolved.kind === "none") return { status: "none", mock: source.mock };
  if (resolved.kind === "choose") return { status: "choose", question: resolved.question, choices: resolved.choices, mock: source.mock };
  const fanbase = resolved.entity;

  const [profiles, tastes] = await Promise.all([
    audienceProfiles([fanbase.id], source, opts, calls),
    Promise.all(
      TASTE.filter((c) => c !== fanbase.category).map(async (category): Promise<TasteRow> => {
        try {
          const res = await source.candidates([fanbase.id], category, undefined, opts);
          calls.push(view(res.meta));
          const scored = scorePartners(res.data, { count: 3, minCategories: 1, excludeIds: [fanbase.id] });
          return { category, label: CATEGORY_LABEL[category], picks: scored.picks };
        } catch (err) {
          console.warn("[tools/fan] failed:", describeFailure(err));
          return { category, label: CATEGORY_LABEL[category], picks: [] };
        }
      }),
    ),
  ]);
  const audience = profiles[0] ?? null;
  const rows = tastes.filter((t) => t.picks.length > 0);
  return { status: "done", fanbase, audience, tastes: rows, intro: introFor(fanbase.name, audience, rows), calls, mock: source.mock };
}
