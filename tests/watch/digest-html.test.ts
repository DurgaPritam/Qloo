import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { digestHtml, EMAIL_PALETTE, EMAIL_THEMES } from "@/lib/email/digest-html";

/** The theme's tokens as app/globals.css defines them. */
function tokens(theme: string): Record<string, string> {
  const css = readFileSync("app/globals.css", "utf8");
  const block = css.match(new RegExp(`\\[data-theme="${theme}"\\] \\{([^}]*)\\}`))![1];
  return Object.fromEntries([...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a: string, b: string) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const html = (theme: (typeof EMAIL_THEMES)[number]) =>
  digestHtml({
    theme,
    intro: "3 things moved on North Star's watchlist this week.",
    lines: [
      { tag: "Rising", title: "Austin up 4 places in the top cities for Ali Wong", body: "Rank #6 → #2; Qloo value 70 → 79 among Ali Wong fans." },
      { tag: "Falling", title: "Ali Wong fans cooling on Hot Ones", body: "Down 8 points, 90 → 82; rank #2 → #3 in the top crossover partners." },
      { tag: "New entry", title: "Liquid Death entered the top crossover partners for Ali Wong", body: "Now #3 at 91 / 100; it was not in the top list last week." },
    ],
    outro: "Every change is Qloo signal.",
    marketWatchUrl: "https://takeover.test/workspace/watch",
    unsubscribeUrl: "https://takeover.test/unsubscribe/digest?token=x",
  });

describe("digest email themes", () => {
  for (const theme of EMAIL_THEMES) {
    describe(theme, () => {
      it("uses only that theme's design tokens, as inline hex colours", () => {
        const t = tokens(theme);
        for (const [name, hex] of Object.entries(EMAIL_PALETTE[theme])) expect(hex, `${theme} ${name}`).toBe(t[name]);
        const used = new Set((html(theme).match(/#[0-9a-f]{6}\b/gi) ?? []).map((h) => h.toLowerCase()));
        const allowed = new Set(Object.values(EMAIL_PALETTE[theme]));
        for (const h of used) expect(allowed.has(h), `${theme} uses ${h}`).toBe(true);
        expect(used.has(EMAIL_PALETTE[theme].bg)).toBe(true);
        expect(used.has(EMAIL_PALETTE[theme].surf)).toBe(true);
      });

      it("is email-safe: no CSS variables, classes, style blocks or scripts; table layout with bgcolor", () => {
        const h = html(theme);
        expect(h).not.toMatch(/var\(|class=|<style|<script|rgba?\(/);
        expect(h).toMatch(new RegExp(`bgcolor="${EMAIL_PALETTE[theme].bg}"`));
        expect(h).toContain('role="presentation"');
        expect(h).toContain("Unsubscribe from this digest");
      });

      it("keeps text readable: at least 4.5:1 for body text, links and the button", () => {
        const c = EMAIL_PALETTE[theme];
        expect(contrast(c.ink, c.surf)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.mute, c.surf)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c["acc-text"], c.surf)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.err, c.surf)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c["on-acc"], c.acc)).toBeGreaterThanOrEqual(4.5);
      });
    });
  }

  it("escapes what it is given", () => {
    const h = digestHtml({ theme: "light", intro: "<b>x</b>", lines: [{ tag: "Rising", title: "A & B", body: '"q"' }], outro: "", marketWatchUrl: "#", unsubscribeUrl: "#" });
    expect(h).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(h).toContain("A &amp; B");
  });
});
