"use client";

import { useEffect, useState } from "react";

// Not imported from ./ui, which imports this file.
const cx = (...c: (string | false)[]) => c.filter(Boolean).join(" ");

/** Saved per browser. The first-paint script in app/layout.tsx reads the same keys. */
export const THEME_KEY = "takeover:theme";
export const STYLE_KEY = "takeover:style";

type Theme = "dark" | "light";

function write(key: string, value: string | null) {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

/** Dark / light and the design's "Gen Z" style (thick ink borders, hard shadows). */
export function AppearanceControls() {
  const [theme, setTheme] = useState<Theme | null>(null);
  const [genz, setGenz] = useState(false);

  // The first-paint script already applied the saved choice; mirror it after mount.
  useEffect(() => {
    const root = document.documentElement;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTheme(root.dataset.theme === "light" ? "light" : "dark");
    setGenz(root.dataset.style === "genz");
  }, []);

  if (theme === null) return <div className="h-[30px] w-[150px]" aria-hidden />;

  const flipTheme = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    write(THEME_KEY, next);
    setTheme(next);
  };
  const flipStyle = () => {
    const next = !genz;
    if (next) document.documentElement.dataset.style = "genz";
    else delete document.documentElement.dataset.style;
    write(STYLE_KEY, next ? "genz" : null);
    setGenz(next);
  };

  // No background in `base`: two bg- classes on one element resolve by stylesheet order, not class order.
  const base = "cursor-pointer whitespace-nowrap rounded-btn border px-2.5 py-1 font-body text-chip";
  return (
    <div className="flex flex-none items-center gap-1.5">
      <button type="button" onClick={flipTheme} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} className={cx(base, "border-line bg-transparent text-ink")}>
        {theme === "dark" ? "☾ Dark" : "☀ Light"}
      </button>
      <button
        type="button"
        onClick={flipStyle}
        aria-pressed={genz}
        className={cx(base, genz ? "border-acc bg-acc font-medium text-on-acc" : "border-line bg-transparent text-mute hover:text-ink")}
      >
        Gen Z mode
      </button>
    </div>
  );
}
