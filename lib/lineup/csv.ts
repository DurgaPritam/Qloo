import { csvRows } from "@/lib/roster/csv";
import { TIERS, type Tier } from "@/lib/engine/lineup";

/**
 * A lineup pool from a CSV: one act per row. Columns, by header name: name (or act, artist), tier
 * (A, B or C) and must_include (yes, true, 1, x). Without a header, the first column is the name.
 * Everything in it is the user's data; names are matched with Qloo afterwards.
 */
export interface CsvPoolAct {
  name: string;
  tier: Tier | null;
  mustInclude: boolean;
}

const yes = (v: string | undefined) => /^(y|yes|true|1|x)$/i.test((v ?? "").trim());

export function parseLineupCsv(text: string, max = 10): { acts: CsvPoolAct[]; dropped: number; error: string | null } {
  const rows = csvRows(text).filter((r) => r.some((c) => c.trim()));
  if (!rows.length) return { acts: [], dropped: 0, error: "That file has no rows." };
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const nameCol = head.findIndex((h) => ["name", "act", "artist", "performer"].includes(h));
  const hasHeader = nameCol >= 0;
  const col = (names: string[]) => head.findIndex((h) => names.includes(h));
  const tierCol = hasHeader ? col(["tier", "fee tier", "fee_tier"]) : -1;
  const mustCol = hasHeader ? col(["must_include", "must include", "must", "include"]) : -1;
  const seen = new Set<string>();
  const acts: CsvPoolAct[] = [];
  for (const r of hasHeader ? rows.slice(1) : rows) {
    const name = (r[hasHeader ? nameCol : 0] ?? "").trim().slice(0, 100);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    const t = (r[tierCol] ?? "").trim().toUpperCase();
    acts.push({ name, tier: tierCol >= 0 && (TIERS as string[]).includes(t) ? (t as Tier) : null, mustInclude: mustCol >= 0 && yes(r[mustCol]) });
  }
  if (!acts.length) return { acts: [], dropped: 0, error: "No act names found. Put one name per row, in a column called name." };
  return { acts: acts.slice(0, max), dropped: Math.max(0, acts.length - max), error: null };
}
