/** Rows one import may carry; each is one Qloo search. */
export const MAX_IMPORT_ROWS = 100;

export interface CsvAct {
  /** 1-based line in the file, for "row 7 didn't match". */
  row: number;
  name: string;
  qlooId?: string;
  homeCity?: string;
}

/** Splits CSV text into rows of fields: quoted fields, "" escapes, commas and newlines inside quotes. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const fold = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * A roster CSV: columns act_name (required), qloo_id and home_city, in any order. A file with no
 * header row is read as one name per line from the first column. Blank and repeated names are
 * dropped; past MAX_IMPORT_ROWS the rest are reported, not imported.
 */
export function parseRosterCsv(text: string): { acts: CsvAct[]; duplicates: number; overLimit: number; error: string | null } {
  // Numbered before blank rows are dropped, so "row 7" is the seventh record of the file.
  const rows = csvRows(text)
    .map((fields, i) => ({ fields, row: i + 1 }))
    .filter((r) => r.fields.some((f) => f.trim()));
  if (!rows.length) return { acts: [], duplicates: 0, overLimit: 0, error: "The file is empty." };
  const header = rows[0].fields.map((h) => fold(h).replace(/[\s-]+/g, "_"));
  const named = header.includes("act_name");
  if (!named && header.some((h) => h === "qloo_id" || h === "home_city")) {
    return { acts: [], duplicates: 0, overLimit: 0, error: "The header needs an act_name column." };
  }
  const col = (name: string) => (named ? header.indexOf(name) : -1);
  const [nameCol, idCol, cityCol] = [named ? col("act_name") : 0, col("qloo_id"), col("home_city")];
  const body = named || header[0] === "name" ? rows.slice(1) : rows;

  const seen = new Set<string>();
  const acts: CsvAct[] = [];
  let duplicates = 0;
  let overLimit = 0;
  for (const { fields: r, row } of body) {
    const name = (r[nameCol] ?? "").trim().slice(0, 100);
    if (!name) continue;
    if (seen.has(fold(name))) {
      duplicates++;
      continue;
    }
    seen.add(fold(name));
    if (acts.length >= MAX_IMPORT_ROWS) {
      overLimit++;
      continue;
    }
    const qlooId = idCol >= 0 ? r[idCol]?.trim() : "";
    const homeCity = cityCol >= 0 ? r[cityCol]?.trim() : "";
    acts.push({ row, name, ...(qlooId ? { qlooId: qlooId.slice(0, 100) } : {}), ...(homeCity ? { homeCity: homeCity.slice(0, 80) } : {}) });
  }
  return { acts, duplicates, overLimit, error: acts.length ? null : "No act names found in the file." };
}

/** Case- and space-insensitive name match, for "already on this roster" before anything is sent. */
export const sameName = (a: string, b: string) => fold(a) === fold(b);
