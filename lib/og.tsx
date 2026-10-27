import { ImageResponse } from "next/og";

/** Social preview size (Open Graph and X large card). */
export const OG_SIZE = { width: 1200, height: 630 };

/** Dark theme tokens from app/globals.css; images can't read CSS variables. */
const T = { bg: "#161826", surf: "#232532", ink: "#e9e9ed", mute: "#9397ab", acc: "#d4ff3a", onAcc: "#161826", line: "#3f424d" };

export function ogCard({ kicker, title, lines, badge }: { kicker: string; title: string; lines: string[]; badge?: string }) {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: T.bg, color: T.ink, padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: 1 }}>TAKEOVER</div>
          <div style={{ fontSize: 20, color: T.mute, letterSpacing: 3 }}>POWERED BY QLOO</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, justifyContent: "center", gap: 18 }}>
          <div style={{ fontSize: 24, color: T.acc, letterSpacing: 3, textTransform: "uppercase" }}>{kicker}</div>
          <div style={{ fontSize: title.length > 40 ? 64 : 80, fontWeight: 800, lineHeight: 1, textTransform: "uppercase" }}>{title}</div>
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
    OG_SIZE,
  );
}
