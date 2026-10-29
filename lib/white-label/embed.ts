import { createHash } from "node:crypto";

import { ATTRIBUTION } from "@/lib/api/attribution";

import { brandVars, type BrandColours } from "./theme";

/**
 * Embeddable widgets as self-contained HTML with a strict Content-Security-Policy: nothing loads
 * from anywhere but this origin, the only inline style and script are the ones built here (allowed
 * by their SHA-256 hashes; no style attributes, so bars are <progress>), no forms, no plugins, and only the workspace's allowed sites (or any,
 * when it lists none) may frame it. Widgets never read or set cookies.
 */
const sha = (s: string) => `'sha256-${createHash("sha256").update(s, "utf8").digest("base64")}'`;
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const HOUSE: BrandColours = { bg: "#161826", text: "#e9e9ed", accent: "#d4ff3a" };

export function cspFor(style: string, script: string | null, frameAncestors: readonly string[]): string {
  return [
    "default-src 'none'",
    `style-src ${sha(style)}`,
    `script-src ${script ? sha(script) : "'none'"}`,
    "img-src 'self' data:",
    `connect-src ${script ? "'self'" : "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${frameAncestors.length ? frameAncestors.join(" ") : "*"}`,
  ].join("; ");
}

export function widgetResponse(input: {
  title: string;
  body: string;
  script?: string | null;
  brand?: { colours: BrandColours; logo: string | null; name: string } | null;
  frameAncestors?: readonly string[];
  /** Data attributes on <body>, so a fixed script can read per-page values. */
  bodyAttrs?: Record<string, string>;
  status?: number;
}): Response {
  const vars = brandVars(input.brand?.colours ?? HOUSE);
  const style = [
    `:root{${Object.entries(vars)
      .map(([k, v]) => `${k}:${v}`)
      .join(";")}}`,
    "*{box-sizing:border-box}body{margin:0;padding:16px;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}",
    "h1{margin:0 0 4px;font-size:18px}p{margin:0 0 8px}.mute{color:var(--mute)}.row{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line)}",
    "progress{appearance:none;-webkit-appearance:none;width:100%;height:6px;border:0;border-radius:99px;background:var(--track);overflow:hidden;display:block}progress::-webkit-progress-bar{background:var(--track)}progress::-webkit-progress-value{background:var(--acc-line)}progress::-moz-progress-bar{background:var(--acc-line)}.gap{margin-top:8px}",
    "button{font:inherit;min-height:36px;padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--surf);color:var(--ink);cursor:pointer}button[aria-pressed=true]{background:var(--acc);color:var(--on-acc);border-color:var(--acc)}",
    "a{color:var(--acc-text)}footer{margin-top:12px;font-size:11px;color:var(--mute)}img.logo{max-height:28px;max-width:40%;display:block;margin-bottom:8px}",
  ].join("");
  const script = input.script ?? null;
  const logo = input.brand?.logo ? `<img class="logo" src="${escapeHtml(input.brand.logo)}" alt="${escapeHtml(input.brand.name)}">` : "";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(input.title)}</title><style>${style}</style></head><body${Object.entries(input.bodyAttrs ?? {})
    .map(([k, v]) => ` data-${k.replace(/[^a-z-]/g, "")}="${escapeHtml(v)}"`)
    .join("")}>${logo}${input.body}<footer><a href="${ATTRIBUTION.url}" target="_blank" rel="noopener noreferrer" data-attribution>${escapeHtml(ATTRIBUTION.text)}</a>. Dates, capacity and prices to confirm with the promoter.</footer>${script ? `<script>${script}</script>` : ""}</body></html>`;
  return new Response(html, {
    status: input.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": cspFor(style, script, input.frameAncestors ?? []),
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": "private, max-age=60",
    },
  });
}
