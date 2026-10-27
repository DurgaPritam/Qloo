"use client";

import { useEffect, useState } from "react";

/** Saved per browser. The first-paint script in app/layout.tsx reads the same key. */
export const THEME_KEY = "takeover:theme";

type Theme = "dark" | "light" | "genz";
const THEMES: { value: Theme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "genz", label: "Gen Z" },
];

/** Applies and saves a theme; outside the component because it writes to the document. */
function applyTheme(next: Theme) {
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

// Not imported from ./ui, which imports this file.
const cx = (...c: (string | false)[]) => c.filter(Boolean).join(" ");

/** The three themes from the design handoff, as a segmented control (same classes as ui.tsx's). */
export function AppearanceControls() {
  const [theme, setTheme] = useState<Theme | null>(null);

  // The first-paint script already applied the saved theme; mirror it after mount.
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(t === "light" || t === "genz" ? t : "dark");
  }, []);

  if (theme === null) return <div className="h-[32px] w-[170px] flex-none" aria-hidden />;

  const choose = (next: Theme) => {
    applyTheme(next);
    setTheme(next);
  };

  return (
    <div role="radiogroup" aria-label="Theme" className="flex flex-none gap-0.5 rounded-md border-card border-ink bg-track p-[3px]">
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={t.value === theme}
          onClick={() => choose(t.value)}
          className={cx(
            "cursor-pointer whitespace-nowrap rounded-btn border-0 px-2.5 py-1 font-body text-chip font-medium",
            t.value === theme ? "bg-surf text-ink shadow-tab" : "bg-transparent text-mute hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
