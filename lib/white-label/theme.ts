import { contrastRatio, mix } from "@/lib/export/branding";

/**
 * A workspace's three brand colours (its branded deck settings) as the page's colour variables, for
 * white-label shared plans and widgets. Lines, surfaces and muted text are blends of the two; accent
 * text falls back to the text colour when the accent is too faint to read on the background.
 */
export interface BrandColours {
  bg: string;
  text: string;
  accent: string;
}

export function brandVars(b: BrandColours): Record<string, string> {
  const onAcc = contrastRatio(b.accent, b.bg) >= contrastRatio(b.accent, b.text) ? b.bg : b.text;
  const accText = contrastRatio(b.accent, b.bg) >= 4.5 ? b.accent : b.text;
  return {
    "--bg": b.bg,
    "--surf": mix(b.bg, b.text, 0.04),
    "--line": mix(b.bg, b.text, 0.2),
    "--ink": b.text,
    "--mute": mix(b.text, b.bg, 0.35),
    "--track": mix(b.bg, b.text, 0.08),
    "--acc": b.accent,
    "--on-acc": onAcc,
    "--acc-text": accText,
    "--acc-line": b.accent,
    "--acc-soft": mix(b.bg, b.accent, 0.15),
  };
}
