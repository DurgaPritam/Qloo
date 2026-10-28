import { TO_CONFIRM } from "@/lib/agent/types";
import { CATEGORY_LABEL } from "@/lib/engine/explain";
import { MOCK_BANNER } from "@/lib/mock-mode";
import type { RosterView } from "@/lib/roster/types";

import { csvCell, type SlideOutline } from "./outline";

/**
 * Roster exports are built from the roster page's data only: every score comes from
 * scoreRosterPairs or the act profiles (engine code); nothing is added here except labels.
 */

const two = (x: number | null) => (x === null ? "" : x.toFixed(2));

/** A spreadsheet must not run a cell as a formula; user-entered text could start with one. */
const safe = (value: unknown) => {
  const s = String(value ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

/** The pair's score from the act on the row to the act in the column, or why there is none. */
function matrixCell(view: RosterView, rowId: string, colId: string): string {
  if (rowId === colId) return "—";
  const pair = view.pairs.find((p) => (p.a.id === rowId && p.b.id === colId) || (p.a.id === colId && p.b.id === rowId));
  if (pair) return String(pair.score);
  const unscored = view.unscored.some((u) => (u.a.id === rowId && u.b.id === colId) || (u.a.id === colId && u.b.id === rowId));
  return unscored ? "no data" : "not scored yet";
}

/**
 * One row per act: its picks, then the shared-audience score (0–100) with every other act, so
 * the act columns form a symmetric matrix. home_city is the user's own data and is labelled so.
 */
export function rosterCsv(view: RosterView): string {
  const source = view.mock ? MOCK_BANNER : "Qloo taste data; scores by Takeover";
  const header = [
    "act",
    "type",
    "best_city",
    "city_confidence",
    "partner",
    "sponsor",
    "confidence",
    "home_city_your_data",
    ...view.acts.map((a) => `shared_0_100_${a.name}`),
    "source",
  ];
  const rows = view.acts.map((a) => [
    a.name,
    a.kind,
    a.profile?.city?.name ?? "",
    a.profile?.city?.confidence ?? "",
    a.profile?.partner?.name ?? "",
    a.profile?.sponsor?.name ?? "",
    a.profile?.confidence ?? "not scored yet",
    a.homeCity ?? "",
    ...view.acts.map((b) => matrixCell(view, a.entityId, b.entityId)),
    source,
  ]);
  return [header, ...rows].map((r) => r.map((v) => csvCell(safe(v))).join(",")).join("\r\n") + "\r\n";
}

export function rosterFileName(view: Pick<RosterView, "name" | "mock">, ext: string): string {
  const base = view.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 60);
  return `${base || "roster"}-roster${view.mock ? "-sample" : ""}.${ext}`;
}

export function rosterFooter(view: Pick<RosterView, "mock">): string {
  return view.mock ? MOCK_BANNER : "Scores computed by Takeover from Qloo taste data.";
}

/** Cover, the acts table, the top pairings, and what was not scored. Plain house style. */
export function rosterOutline(view: RosterView): SlideOutline[] {
  const slides: SlideOutline[] = [
    {
      title: view.name,
      subtitle: `${view.acts.length} act${view.acts.length === 1 ? "" : "s"} · ${view.pairs.length} scored pairing${view.pairs.length === 1 ? "" : "s"}`,
    },
  ];
  const scored = view.acts.filter((a) => a.profile);
  if (scored.length) {
    for (let i = 0; i < scored.length; i += 10) {
      slides.push({
        title: i === 0 ? "The roster" : "The roster (continued)",
        table: {
          columns: ["Act", "Best city", "Partner", "Sponsor", "Confidence"],
          rows: scored.slice(i, i + 10).map((a) => [
            a.name,
            a.profile!.city?.name ?? "—",
            a.profile!.partner ? `${a.profile!.partner.name} (${CATEGORY_LABEL[a.profile!.partner.category]})` : "—",
            a.profile!.sponsor?.name ?? "—",
            a.profile!.confidence,
          ]),
        },
        note: "Best city, partner and sponsor per act, ranked by Takeover's engine on Qloo affinity. Confidence is the weakest of the three.",
      });
    }
  }
  const top = view.pairs.slice(0, 8);
  if (top.length) {
    slides.push({
      title: "Pairings",
      table: {
        columns: ["Pair", "Shared score", "B among A's fans", "A among B's fans", "Where"],
        rows: top.map((p) => [`${p.a.name} + ${p.b.name}`, `${p.score} / 100`, two(p.evidence.bAmongA), two(p.evidence.aAmongB), p.city?.name ?? "—"]),
      },
      note: `Shared score: the mean of the Qloo affinities in both directions, 0–100. Capacity, dates and fees: ${TO_CONFIRM}.`,
    });
  }
  const missing = view.acts.length - scored.length + view.unscored.length + view.pendingPairs;
  if (missing) {
    slides.push({
      title: "Not scored",
      bullets: [
        ...view.acts.filter((a) => !a.profile).map((a) => `${a.name}: not scored yet.`),
        ...view.unscored.map((u) => `${u.a.name} + ${u.b.name}: ${u.reason}`),
        ...(view.pendingPairs ? [`${view.pendingPairs} pairing${view.pendingPairs === 1 ? "" : "s"} not asked of Qloo yet; refresh the roster.`] : []),
      ],
    });
  }
  return slides;
}
