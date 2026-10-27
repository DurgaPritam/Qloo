import { readFile } from "node:fs/promises";
import path from "node:path";

import { ImageResponse } from "next/og";

/**
 * Anton, the site's headline face (SIL Open Font License, lib/fonts/OFL-Anton.txt). Read from the
 * repo at request time; next.config.ts traces lib/fonts into the image routes.
 */
let anton: Promise<Buffer> | null = null;
async function fonts() {
  anton ??= readFile(path.join(process.cwd(), "lib/fonts/Anton-Regular.ttf"));
  return [{ name: "Anton", data: await anton, weight: 400 as const, style: "normal" as const }];
}

/** Social preview size (Open Graph and X large card). */
export const OG_SIZE = { width: 1200, height: 630 };

/** Dark theme tokens from app/globals.css; images can't read CSS variables. */
const T = { bg: "#161826", surf: "#232532", ink: "#e9e9ed", mute: "#9397ab", acc: "#d4ff3a", onAcc: "#161826", line: "#3f424d" };

export async function ogCard({ kicker, title, lines, badge }: { kicker: string; title: string; lines: string[]; badge?: string }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: T.bg, color: T.ink, padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 40, fontFamily: "Anton", letterSpacing: 1 }}>TAKEOVER</div>
          <div style={{ fontSize: 20, color: T.mute, letterSpacing: 3 }}>POWERED BY QLOO</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 18 }}>
          <div style={{ fontSize: 24, color: T.acc, letterSpacing: 3, textTransform: "uppercase" }}>{kicker}</div>
          <div style={{ fontSize: title.length > 40 ? 64 : 80, fontFamily: "Anton", lineHeight: 1, textTransform: "uppercase" }}>{title}</div>
          {lines.map((l) => (
            <div key={l} style={{ fontSize: 30, color: T.mute }}>
              {l}
            </div>
          ))}
        </div>
        {badge && (
          <div style={{ display: "flex" }}>
            <div style={{ background: T.acc, color: T.onAcc, fontSize: 24, padding: "10px 20px", borderRadius: 8 }}>{badge}</div>
          </div>
        )}
      </div>
    ),
    { ...OG_SIZE, fonts: await fonts() },
  );
}

/** The festival poster (portrait, 1080 × 1350): every name is a Qloo pick saved with the lineup. */
export const POSTER_SIZE = { width: 1080, height: 1350 };

export async function posterImage(p: {
  title: string;
  headliner: string;
  acts: string[];
  host: string | null;
  city: string | null;
  venue: string | null;
  crowdFit: number;
}, size: { width: number; height: number } = POSTER_SIZE) {
  const big = size.height > 1000;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#f4eee0", color: "#1d1b26", padding: big ? 72 : 48, fontFamily: "sans-serif", border: "14px solid #1d1b26" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: big ? 26 : 20, letterSpacing: 4 }}>
          <div style={{ display: "flex" }}>TAKEOVER PRESENTS</div>
          <div style={{ display: "flex" }}>POWERED BY QLOO</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", alignItems: "center", gap: big ? 28 : 14, textAlign: "center" }}>
          <div style={{ display: "flex", fontSize: big ? 44 : 30, letterSpacing: 6, textTransform: "uppercase" }}>{p.title}</div>
          <div style={{ display: "flex", fontSize: p.headliner.length > 18 ? (big ? 110 : 70) : big ? 150 : 96, fontFamily: "Anton", lineHeight: 0.95, textTransform: "uppercase" }}>{p.headliner}</div>
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: big ? 18 : 10, maxWidth: "90%" }}>
            {p.acts.map((a) => (
              <div key={a} style={{ display: "flex", fontSize: big ? 52 : 32, fontFamily: "Anton", textTransform: "uppercase" }}>
                {a}
              </div>
            ))}
          </div>
          {p.host && <div style={{ display: "flex", fontSize: big ? 32 : 22 }}>{`Hosted by ${p.host}`}</div>}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: big ? 34 : 22, textTransform: "uppercase" }}>
            <div style={{ display: "flex" }}>{p.venue ?? ""}</div>
            <div style={{ display: "flex", fontFamily: "Anton", fontSize: big ? 44 : 28 }}>{p.city ?? ""}</div>
            <div style={{ display: "flex", fontSize: big ? 22 : 16 }}>Dates to confirm with the promoter</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", background: "#d4ff3a", border: "6px solid #1d1b26", padding: big ? "16px 24px" : "10px 16px" }}>
            <div style={{ display: "flex", fontSize: big ? 80 : 48, fontFamily: "Anton" }}>{p.crowdFit}</div>
            <div style={{ display: "flex", fontSize: big ? 20 : 14, letterSpacing: 2 }}>CROWD FIT</div>
          </div>
        </div>
      </div>
    ),
    { ...size, fonts: await fonts() },
  );
}
