import type { Metadata, Viewport } from "next";
import { Anton, Inter, JetBrains_Mono } from "next/font/google";
import Script from "next/script";

import { MockBanner } from "@/components/mock-banner";
import { isMockMode } from "@/lib/mock-mode";

import "./globals.css";

const anton = Anton({ weight: "400", subsets: ["latin"], variable: "--font-anton" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "Takeover",
  description:
    "The market-entry agent for anyone with a fanbase: a crossover partner, the city where both audiences are strongest, the room, sponsors, a brief and outreach drafts. Backed by Qloo taste data.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#161826" },
    { media: "(prefers-color-scheme: light)", color: "#f3f5fe" },
  ],
};

// Before first paint: the saved theme (components/appearance.tsx), else a light system
// preference, else dark; and the saved "Gen Z" style.
const THEME_SCRIPT = `try{var d=document.documentElement,t=localStorage.getItem("takeover:theme");if(t==="light"||t==="dark")d.dataset.theme=t;else if(matchMedia("(prefers-color-scheme: light)").matches)d.dataset.theme="light";if(localStorage.getItem("takeover:style")==="genz")d.dataset.style="genz"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${anton.variable} ${inter.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      {/* Browser extensions add attributes to <body> before React loads; that mismatch is not ours. */}
      <body suppressHydrationWarning>
        <Script id="theme" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
        {isMockMode() && <MockBanner />}
        {children}
      </body>
    </html>
  );
}
