"use client";

import type { Plan } from "@/lib/agent/types";
import { citiesCsv, deckOutline, exportFileName, exportFooter, type SlideOutline } from "@/lib/export/outline";

/** Design tokens (dark theme) as PowerPoint hex colours. */
const C = { bg: "161826", surf: "232532", line: "3F424D", ink: "E9E9ED", mute: "9397AB", acc: "D4FF3A", warn: "E8B04A" };
// Anton, Inter and JetBrains Mono are web fonts; decks use fonts every machine has.
const DISPLAY = "Arial Black";
const BODY = "Arial";

/** Approximate Arial Black uppercase advance, inches per point per character. */
const CHAR_W = 0.0105;

function titleSize(chars: number, cover: boolean): number {
  if (cover) return chars > 60 ? 30 : 40;
  if (chars > 70) return 18;
  return chars > 45 ? 22 : 26;
}

export function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(plan: Plan) {
  save(new Blob([citiesCsv(plan)], { type: "text/csv;charset=utf-8" }), exportFileName(plan, "csv"));
}

/** Builds the partner deck in the browser; the library loads only when asked for. */
export async function downloadDeck(plan: Plan) {
  await renderDeck(deckOutline(plan), {
    title: plan.brief?.title ?? "Takeover plan",
    footer: exportFooter(plan),
    mock: plan.mock,
    fileName: exportFileName(plan, "pptx"),
  });
}

/** The house deck: dark theme, one outline slide per slide, the footer (or sample-data label) on each. */
export async function renderDeck(slides: SlideOutline[], deck: { title: string; footer: string; mock: boolean; fileName: string }) {
  const pptx = await buildDeck(slides, deck);
  await pptx.writeFile({ fileName: deck.fileName });
}

/** Builds the deck without saving it, so tests can open the real file. */
export async function buildDeck(slides: SlideOutline[], deck: { title: string; footer: string; mock: boolean }) {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pptx.title = deck.title;
  const footer = deck.footer;

  for (const [i, s] of slides.entries()) {
    const slide = pptx.addSlide();
    slide.background = { color: C.bg };
    slide.addText("TAKEOVER", { x: 0.5, y: 0.3, w: 4, h: 0.4, fontFace: DISPLAY, fontSize: 14, color: C.ink, margin: 0 });
    slide.addText(`${i + 1}`, { x: 12.3, y: 0.3, w: 0.5, h: 0.4, fontFace: BODY, fontSize: 11, color: C.mute, align: "right" });
    // Sized from the length: viewers that ignore "shrink to fit" must not overlap the text below.
    const size = titleSize(s.title.length, i === 0);
    const lines = Math.ceil((s.title.length * size * CHAR_W) / 12.3);
    const titleH = Math.max(0.6, lines * size * 1.15 / 72);
    const top = i === 0 ? 2.2 : 0.9;
    slide.addText(s.title.toUpperCase(), {
      x: 0.5,
      y: top,
      w: 12.3,
      h: titleH,
      fontFace: DISPLAY,
      fontSize: size,
      color: C.ink,
      fit: "shrink",
      valign: "top",
      margin: 0,
    });
    let y = top + titleH + 0.2;
    if (s.subtitle) {
      slide.addText(s.subtitle, { x: 0.5, y, w: 12.3, h: 0.7, fontFace: BODY, fontSize: 14, color: C.mute, fit: "shrink", valign: "top", margin: 0 });
      y += 0.8;
    }
    if (s.table) {
      const head = s.table.columns.map((text) => ({
        text: text.toUpperCase(),
        options: { color: C.mute, fontSize: 10, bold: true, fill: { color: C.surf } },
      }));
      const body = s.table.rows.map((row, r) =>
        row.map((text, c) => ({
          text,
          options: { color: r === 0 && c > 1 ? C.acc : C.ink, fontSize: 12, align: c === 0 ? ("left" as const) : ("right" as const) },
        })),
      );
      slide.addTable([head, ...body], {
        x: 0.5,
        y,
        w: 12.3,
        fontFace: BODY,
        border: { type: "solid", pt: 0.5, color: C.line },
        rowH: 0.36,
        autoPage: false,
      });
      y += 0.36 * (body.length + 1) + 0.3;
    }
    if (s.bullets) {
      slide.addText(
        s.bullets.map((text) => ({ text, options: { bullet: true, breakLine: true } })),
        { x: 0.5, y, w: 12.3, h: 6.6 - y, fontFace: BODY, fontSize: 14, color: C.ink, valign: "top", fit: "shrink", paraSpaceAfter: 6 },
      );
    }
    if (s.note) {
      slide.addText(s.note, { x: 0.5, y: 6.4, w: 12.3, h: 0.4, fontFace: BODY, fontSize: 11, color: C.mute, fit: "shrink", margin: 0 });
    }
    slide.addText(footer, {
      x: 0.5,
      y: 6.9,
      w: 12.3,
      h: 0.35,
      fontFace: BODY,
      fontSize: 10,
      color: deck.mock ? C.warn : C.mute,
      bold: deck.mock,
      margin: 0,
    });
  }
  return pptx;
}
