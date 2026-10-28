/**
 * The Market watch digest as an email, in the three themes. Email clients ignore CSS variables,
 * classes and most of <style>, so every colour is an inline hex value copied from that theme's
 * design tokens (app/globals.css; a test checks they match), the layout is tables, and fonts fall
 * back to ones every client has. No server-only code: the page renders the same HTML as a preview.
 */
export const EMAIL_THEMES = ["light", "dark", "genz"] as const;
export type EmailTheme = (typeof EMAIL_THEMES)[number];

export const EMAIL_THEME_LABEL: Record<EmailTheme, string> = { light: "Light", dark: "Dark", genz: "Gen Z" };

/** Token values per theme (names as in app/globals.css). Nothing here is a new colour. */
export const EMAIL_PALETTE: Record<EmailTheme, { bg: string; surf: string; line: string; ink: string; mute: string; acc: string; "on-acc": string; "acc-text": string; "acc-line": string; err: string }> = {
  light: { bg: "#f3f5fe", surf: "#fbfbff", line: "#cfd3e5", ink: "#161826", mute: "#595d6c", acc: "#c6f02a", "on-acc": "#161826", "acc-text": "#4d6300", "acc-line": "#6b8a00", err: "#b3261e" },
  dark: { bg: "#161826", surf: "#232532", line: "#3f424d", ink: "#e9e9ed", mute: "#9397ab", acc: "#d4ff3a", "on-acc": "#161826", "acc-text": "#d4ff3a", "acc-line": "#d4ff3a", err: "#f2706a" },
  genz: { bg: "#f4eee0", surf: "#fbf8f1", line: "#1d1b26", ink: "#1d1b26", mute: "#4f4c5c", acc: "#d4ff3a", "on-acc": "#1d1b26", "acc-text": "#4d6300", "acc-line": "#6b8a00", err: "#b3261e" },
};

export interface DigestLineView {
  tag: string;
  title: string;
  body: string;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const SANS = "Inter, Helvetica, Arial, sans-serif";
const DISPLAY = "'Arial Black', 'Helvetica Neue', Arial, sans-serif";
const MONO = "'JetBrains Mono', Menlo, Consolas, 'Courier New', monospace";

export function digestHtml(input: { theme: EmailTheme; intro: string; lines: DigestLineView[]; outro: string; marketWatchUrl: string; unsubscribeUrl: string }): string {
  const c = EMAIL_PALETTE[input.theme];
  const genz = input.theme === "genz";
  // Gen Z: hard ink outlines and offset shadows (clients without box-shadow keep the outline).
  const card = genz ? `border:2px solid ${c.line};box-shadow:4px 4px 0 ${c.line};` : `border:1px solid ${c.line};`;
  const tag = (t: string) => {
    const tone = t === "Falling" ? c.err : c["acc-text"];
    const edge = t === "Falling" ? c.err : c["acc-line"];
    return t ? `<span style="display:inline-block;font-family:${MONO};font-size:10px;letter-spacing:0.06em;text-transform:uppercase;color:${tone};border:1px solid ${edge};border-radius:4px;padding:1px 6px">${esc(t)}</span>` : "";
  };
  const rows = input.lines
    .map(
      (l) => `<tr><td style="padding:14px 0;border-top:1px solid ${c.line}">
${tag(l.tag)}
<div style="font-family:${SANS};font-size:15px;font-weight:600;line-height:1.35;color:${c.ink};margin-top:6px">${esc(l.title)}</div>
<div style="font-family:${SANS};font-size:13px;line-height:1.5;color:${c.mute};margin-top:2px">${esc(l.body)}</div>
</td></tr>`,
    )
    .join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="${input.theme === "dark" ? "dark" : "light"}"><meta name="supported-color-schemes" content="${input.theme === "dark" ? "dark" : "light"}"></head>
<body style="margin:0;padding:0;background:${c.bg}" bgcolor="${c.bg}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.bg}" style="background:${c.bg}"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${c.surf}" style="max-width:600px;width:100%;background:${c.surf};${card}border-radius:14px">
<tr><td style="padding:24px 24px 4px">
<div style="font-family:${DISPLAY};font-size:22px;line-height:1;text-transform:uppercase;color:${c.ink}">Takeover</div>
<div style="font-family:${MONO};font-size:10px;letter-spacing:0.08em;text-transform:uppercase;color:${c.mute};margin-top:10px">Market watch · weekly digest</div>
</td></tr>
<tr><td style="padding:12px 24px 0;font-family:${SANS};font-size:15px;line-height:1.5;color:${c.ink}">${esc(input.intro)}</td></tr>
<tr><td style="padding:8px 24px 0"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${rows}</table></td></tr>
<tr><td style="padding:16px 24px 8px"><a href="${esc(input.marketWatchUrl)}" style="display:inline-block;background:${c.acc};color:${c["on-acc"]};font-family:${SANS};font-size:14px;font-weight:600;text-decoration:none;padding:10px 16px;border-radius:6px;${genz ? `border:2px solid ${c.line};` : ""}">Open Market watch</a></td></tr>
<tr><td style="padding:8px 24px 24px;font-family:${SANS};font-size:12px;line-height:1.5;color:${c.mute}">${esc(input.outro)}<br><a href="${esc(input.unsubscribeUrl)}" style="color:${c["acc-text"]}">Unsubscribe from this digest</a></td></tr>
</table>
</td></tr></table>
</body></html>`;
}
