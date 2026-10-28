import type { GroupResult } from "@/lib/engine/outcomes";

import { csvCell, type SlideOutline } from "./outline";

/**
 * The Outcomes report as CSV and as a deck. Predictions are the plan's frozen values; results are the
 * workspace's own data and are labelled so; sell-through and the median come from engine code.
 */
export interface ReportRow {
  plan: string;
  city: string | null;
  partner: string | null;
  /** Frozen at plan time. */
  predictedCity: number | null;
  predictedPartner: number | null;
  attendance: number | null;
  ticketsSold: number | null;
  capacity: number | null;
  sellThrough: number | null;
  gross: number | null;
  sponsorRenewed: boolean | null;
  aboveMedian: boolean | null;
}

export interface ReportView {
  workspace: string;
  /** ISO code of the gross amounts (workspace setting); null when not set. */
  currency: string | null;
  rows: ReportRow[];
  sample: number;
  median: number | null;
  minSample: number;
  judged: boolean;
  aboveMedian: number;
  cities: GroupResult[];
  partners: GroupResult[];
}

const pct = (x: number | null) => (x === null ? "" : `${Math.round(x * 100)}%`);
const two = (x: number | null) => (x === null ? "" : x.toFixed(2));
const safe = (v: unknown) => {
  const s = String(v ?? "");
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
};

export function outcomesCsv(v: ReportView): string {
  const header = [
    "plan",
    "chosen_city",
    "chosen_partner",
    "predicted_city_score_0_1",
    "predicted_partner_score",
    "attendance_your_data",
    "tickets_sold_your_data",
    "capacity_your_data",
    "sell_through",
    "gross_your_data",
    "gross_currency",
    "sponsor_renewed_your_data",
    "above_workspace_median",
  ];
  const rows = v.rows.map((r) => [
    r.plan,
    r.city ?? "",
    r.partner ?? "",
    two(r.predictedCity),
    two(r.predictedPartner),
    r.attendance ?? "",
    r.ticketsSold ?? "",
    r.capacity ?? "",
    pct(r.sellThrough),
    r.gross ?? "",
    r.gross === null ? "" : (v.currency ?? "not set"),
    r.sponsorRenewed === null ? "" : r.sponsorRenewed ? "yes" : "no",
    !v.judged || r.aboveMedian === null ? "too few events to judge" : r.aboveMedian ? "yes" : "no",
  ]);
  return [header, ...rows].map((r) => r.map((x) => csvCell(safe(x))).join(",")).join("\r\n") + "\r\n";
}

const groupRows = (gs: GroupResult[]) => gs.slice(0, 10).map((g) => [g.name, String(g.events), g.judged ? `${g.above} of ${g.events}` : "too few events to judge"]);

export function outcomesOutline(v: ReportView): SlideOutline[] {
  const slides: SlideOutline[] = [
    {
      title: `${v.workspace}: outcomes`,
      subtitle: v.median === null ? "No event has both tickets sold and capacity logged yet." : `${v.sample} events with sell-through · median ${pct(v.median)}`,
    },
  ];
  if (!v.judged) {
    slides.push({ title: "Too few events to judge", bullets: [`${v.sample} of ${v.minSample} events needed before comparing cities and partners with your median.`] });
  } else {
    slides.push({
      title: "Chosen cities against your median",
      table: { columns: ["City", "Events", "Above median"], rows: groupRows(v.cities) },
      note: "A city with fewer events than the minimum is not judged.",
    });
    slides.push({ title: "Chosen partners against your median", table: { columns: ["Partner", "Events", "Above median"], rows: groupRows(v.partners) } });
  }
  if (v.rows.length) {
    slides.push({
      title: "Logged events",
      table: { columns: ["Plan", "City", "Sell-through"], rows: v.rows.slice(0, 12).map((r) => [r.plan, r.city ?? "—", pct(r.sellThrough) || "—"]) },
      note: "Results are your data, entered by your team and not checked by Takeover. Predictions are the plan's, frozen when it was made.",
    });
  }
  return slides;
}

export const outcomesFileName = (v: Pick<ReportView, "workspace">, ext: string) =>
  `${v.workspace.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 50) || "workspace"}-outcomes.${ext}`;
