import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";

import { parseNumber, readTable } from "@/lib/data/table";

const enc = (s: string) => new TextEncoder().encode(s);

/** A minimal real .xlsx: workbook, relationships, shared strings and one sheet. */
function xlsx(): Uint8Array {
  const sheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>note</t></is></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>1742</v></c><c r="C2" t="inlineStr"><is><t>A &amp; B</t></is></c></row>
<row r="3"><c r="A3" t="s"><v>3</v></c><c r="C3" t="b"><v>1</v></c></row>
</sheetData></worksheet>`;
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(`<workbook xmlns:r="r"><sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sales.xml"/></Relationships>`),
    "xl/sharedStrings.xml": strToU8(`<sst><si><t>metro_name</t></si><si><t>tix</t></si><si><r><t>Los </t></r><r><t>Angeles</t></r></si><si><t>Chicago</t></si></sst>`),
    "xl/worksheets/sales.xml": strToU8(sheet),
  });
}

describe("readTable", () => {
  it("reads a CSV header and rows", () => {
    const t = readTable(enc("metro_name,tix\nLos Angeles,\"1,742\"\n\nChicago,1310\n"), "sales.csv");
    expect(t.columns).toEqual(["metro_name", "tix"]);
    expect(t.rows).toEqual([
      ["Los Angeles", "1,742"],
      ["Chicago", "1310"],
    ]);
  });

  it("reads the first sheet of an XLSX: shared strings in runs, inline strings, numbers, gaps, booleans", () => {
    const t = readTable(xlsx(), "sales.xlsx");
    expect(t.columns).toEqual(["metro_name", "tix", "note"]);
    expect(t.rows).toEqual([
      ["Los Angeles", "1742", "A & B"],
      ["Chicago", "", "TRUE"],
    ]);
  });

  it("refuses other files, empty files and broken workbooks with a reason", () => {
    expect(() => readTable(enc("a,b"), "sales.numbers")).toThrow(/\.csv or \.xlsx/);
    expect(() => readTable(enc("city\n"), "x.csv")).toThrow(/header row and at least one row/);
    expect(() => readTable(enc("not a zip"), "x.xlsx")).toThrow(/could not be opened/);
  });

  it("parses numbers the way exports write them", () => {
    expect(parseNumber("1,742")).toBe(1742);
    expect(parseNumber("$2,310.50")).toBe(2310.5);
    expect(parseNumber("12 400")).toBe(12400);
    expect(parseNumber("n/a")).toBeNull();
    expect(parseNumber("")).toBeNull();
  });
});
