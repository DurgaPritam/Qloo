import { CATEGORY_LABEL } from "@/lib/engine/explain";
import type { WatchChange } from "@/lib/engine/watch";

/**
 * Alert text, filled from the diff only: names, ranks and values from the two snapshots. The
 * model may rephrase it (lib/watch/digest.ts), and a rephrasing that adds or changes a fact is
 * thrown away.
 */
export type WatchKind = "fanbase" | "city";

const points = (v: number) => Math.round(v * 100);

export function listLabel(list: string): string {
  if (list === "cities") return "top cities";
  if (list === "partners") return "top crossover partners";
  const category = list.replace(/^category:/, "") as keyof typeof CATEGORY_LABEL;
  return `top ${CATEGORY_LABEL[category] ?? category}s`;
}

/** The design's tags: Rising, Falling, New entry. */
export function tagFor(change: Pick<WatchChange, "kind">): "Rising" | "Falling" | "New entry" {
  if (change.kind === "new") return "New entry";
  if (change.kind === "dropped") return "Falling";
  return change.kind === "rank_up" || change.kind === "value_up" ? "Rising" : "Falling";
}

export function alertText(change: WatchChange, item: { name: string; kind: WatchKind }): { title: string; body: string } {
  const owner = item.kind === "fanbase" ? `${item.name} fans` : `people in ${item.name}`;
  const list = listLabel(change.list);
  const a = change.after;
  const b = change.before;
  if (change.kind === "dropped" && b) {
    return {
      title: `${change.name} dropped out of the ${list} for ${item.name}`,
      body: `Was #${b.rank} at ${points(b.value)} / 100 last week; ${a ? `now #${a.rank} at ${points(a.value)} / 100, below the top list` : "not in the list this week"}.`,
    };
  }
  if (!a) return { title: `${change.name} changed in the ${list} for ${item.name}`, body: "" };
  if (change.kind === "new" || !b) {
    return {
      title: `${change.name} entered the ${list} for ${item.name}`,
      body: `Now #${a.rank} at ${points(a.value)} / 100; it was not in the top list last week.`,
    };
  }
  const value = `${points(b.value)} → ${points(a.value)}`;
  const rank = `#${b.rank} → #${a.rank}`;
  if (change.kind === "rank_up" || change.kind === "rank_down") {
    const up = change.kind === "rank_up";
    return {
      title: `${change.name} ${up ? "up" : "down"} ${Math.abs(b.rank - a.rank)} places in the ${list} for ${item.name}`,
      body: `Rank ${rank}; Qloo value ${value} among ${owner}.`,
    };
  }
  const up = change.kind === "value_up";
  return {
    title: `${owner.charAt(0).toUpperCase()}${owner.slice(1)} ${up ? "warming to" : "cooling on"} ${change.name}`,
    body: `${up ? "Up" : "Down"} ${Math.abs(points(a.value) - points(b.value))} points, ${value}; ${a.rank === b.rank ? `still #${a.rank}` : `rank ${rank}`} in the ${list}.`,
  };
}

/** Numbers and names in a text, to compare a rephrasing with the template it came from. */
function facts(text: string, names: readonly string[]) {
  return {
    numbers: (text.match(/\d+(?:\.\d+)?/g) ?? []).sort(),
    names: names.filter((n) => text.includes(n)).sort(),
  };
}

/**
 * Accepts the model's rephrasing only if it keeps exactly the template's numbers and names and
 * adds none: anything else falls back to the template.
 */
export function safeRephrase(template: string, rephrased: string | null | undefined, names: readonly string[]): string {
  const r = rephrased?.trim();
  if (!r || r.length > template.length * 2 + 40) return template;
  const before = facts(template, names);
  const after = facts(r, names);
  const same = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i]);
  return same(before.numbers, after.numbers) && same(before.names, after.names) ? r : template;
}
