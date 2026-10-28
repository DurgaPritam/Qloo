/**
 * A workspace's branded deck settings (Feature 10): applied to every deck it exports. Colours are
 * the workspace's own choice; the defaults are Takeover's dark theme tokens. No server-only code:
 * decks are built in the browser.
 */
export const DECK_FONTS = ["anton", "inter", "georgia"] as const;
export type DeckFont = (typeof DECK_FONTS)[number];

/** What the settings page offers, and the font each maps to in a deck file. */
export const DECK_FONT_LABEL: Record<DeckFont, string> = { anton: "Anton", inter: "Inter Bold", georgia: "Georgia (serif)" };
/** Decks use fonts every machine has, so a file never falls back to a random substitute. */
export const DECK_FONT_FACE: Record<DeckFont, { face: string; bold: boolean; upper: boolean }> = {
  anton: { face: "Impact", bold: false, upper: true },
  inter: { face: "Arial", bold: true, upper: false },
  georgia: { face: "Georgia", bold: true, upper: false },
};

export interface DeckBranding {
  /** Hex colours, "#rrggbb". */
  bg: string;
  text: string;
  accent: string;
  font: DeckFont;
  /** A PNG or JPEG as a data URL, with its pixel size for the aspect ratio. */
  logo: { dataUrl: string; width: number; height: number } | null;
  /** Shown where the logo would be when there is none. */
  name: string;
}

/** Takeover's dark theme (app/globals.css), the house deck. */
export const DEFAULT_BRANDING: Omit<DeckBranding, "name"> = { bg: "#161826", text: "#e9e9ed", accent: "#d4ff3a", font: "anton", logo: null };

export const MAX_LOGO_BYTES = 300 * 1024;
export const MIN_CONTRAST = 4.5;

const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (s: unknown): s is string => typeof s === "string" && HEX.test(s);
export const normaliseHex = (s: string) => {
  const t = s.trim();
  return (t.startsWith("#") ? t : `#${t}`).toLowerCase();
};

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two hex colours, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** A colour part-way from `a` to `b` (0 = a, 1 = b), for secondary text and lines derived from the brand's own colours. */
export function mix(a: string, b: string, t: number): string {
  const ch = (h: string, i: number) => parseInt(h.slice(i, i + 2), 16);
  return `#${[1, 3, 5].map((i) => Math.round(ch(a, i) + (ch(b, i) - ch(a, i)) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Checks a logo data URL: PNG or JPEG only (no SVG: it can carry script), at most MAX_LOGO_BYTES. */
export function logoProblem(dataUrl: string): string | null {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return "Use a PNG or JPEG logo.";
  const bytes = Math.floor((m[2].length * 3) / 4);
  return bytes > MAX_LOGO_BYTES ? "The logo is over 300 KB; export a smaller PNG." : null;
}

/** Hex without "#", as pptxgenjs takes colours. */
export const pptx = (hex: string) => hex.replace("#", "").toUpperCase();

/** The branding a workspace's exports use: its saved settings, or the house deck with its name. */
export function brandingFrom(
  row: { bg: string; text: string; accent: string; font: DeckFont; logoData: string | null; logoWidth: number | null; logoHeight: number | null } | null,
  name: string,
): DeckBranding {
  if (!row) return { ...DEFAULT_BRANDING, name };
  const logo = row.logoData && row.logoWidth && row.logoHeight ? { dataUrl: row.logoData, width: row.logoWidth, height: row.logoHeight } : null;
  return { bg: row.bg, text: row.text, accent: row.accent, font: row.font, logo, name };
}
