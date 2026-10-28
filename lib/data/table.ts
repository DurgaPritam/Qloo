import { strFromU8, unzipSync } from "fflate";

import { csvRows } from "@/lib/roster/csv";

/**
 * Reads an uploaded CSV or XLSX into a header and rows of text, the same in the browser (for the
 * preview and column mapping) and on the server (for what is stored). XLSX is a zip of XML: the
 * first sheet is read with its shared strings; formulas count as their cached values.
 */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_DATA_ROWS = 5000;

export interface Table {
  columns: string[];
  rows: string[][];
  /** Rows past MAX_DATA_ROWS, not read. */
  truncated: number;
}

export class TableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TableError";
  }
}

export function fileKind(fileName: string): "csv" | "xlsx" | null {
  const ext = fileName.toLowerCase().split(".").pop();
  return ext === "csv" ? "csv" : ext === "xlsx" ? "xlsx" : null;
}

export function readTable(bytes: Uint8Array, fileName: string): Table {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new TableError("The file is over 5 MB.");
  const kind = fileKind(fileName);
  if (!kind) throw new TableError("Upload a .csv or .xlsx file.");
  const grid = kind === "csv" ? csvRows(new TextDecoder().decode(bytes)) : xlsxRows(bytes);
  const filled = grid.filter((r) => r.some((c) => c.trim()));
  if (filled.length < 2) throw new TableError("The file needs a header row and at least one row of data.");
  const width = Math.max(...filled.map((r) => r.length));
  const columns = Array.from({ length: width }, (_, i) => filled[0][i]?.trim() || `Column ${i + 1}`);
  const body = filled.slice(1).map((r) => Array.from({ length: width }, (_, i) => (r[i] ?? "").trim()));
  return { columns, rows: body.slice(0, MAX_DATA_ROWS), truncated: Math.max(0, body.length - MAX_DATA_ROWS) };
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
  );

/** Concatenated <t> runs inside an element (shared strings and inline strings may be split into runs). */
const texts = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join("");

/** "BC12" → 54 (zero-based column). */
function columnIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() ?? "A";
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

function xlsxRows(bytes: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes, { filter: (f) => (f.name.startsWith("xl/") && f.name.endsWith(".xml")) || f.name.endsWith(".rels") });
  } catch {
    throw new TableError("That .xlsx file could not be opened.");
  }
  const read = (name: string) => (files[name] ? strFromU8(files[name]) : null);
  const workbook = read("xl/workbook.xml");
  if (!workbook) throw new TableError("That .xlsx file has no workbook.");
  const firstSheet = workbook.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const rels = read("xl/_rels/workbook.xml.rels") ?? "";
  const target = [...rels.matchAll(/<Relationship\b([^>]*)\/?>/g)]
    .map((m) => m[1])
    .find((attrs) => attrs.includes(`Id="${firstSheet}"`))
    ?.match(/Target="([^"]+)"/)?.[1];
  const path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`) : "xl/worksheets/sheet1.xml";
  const sheet = read(path);
  if (!sheet) throw new TableError("That .xlsx file has no readable sheet.");

  const shared = [...(read("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1]));
  const rows: string[][] = [];
  for (const row of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length > MAX_DATA_ROWS + 1) break;
    const out: string[] = [];
    for (const cell of row[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const inner = cell[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/i)?.[1];
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = texts(inner);
      else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
      else if (v !== undefined) value = unescapeXml(v);
      out[ref ? columnIndex(ref) : out.length] = value;
    }
    rows.push(Array.from(out, (x) => x ?? ""));
  }
  return rows;
}

/** "1,742", "$2,310.50", "12 400" → a number; anything else → null. */
export function parseNumber(text: string): number | null {
  const t = text.trim().replace(/[\s,$€£¥%]/g, "");
  if (!/^-?\d*\.?\d+(e[+-]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
