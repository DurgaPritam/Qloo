"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { contrastRatio, DECK_FONT_LABEL, DECK_FONTS, DEFAULT_BRANDING, isHex, logoProblem, MIN_CONTRAST, normaliseHex, type DeckBranding, type DeckFont } from "@/lib/export/branding";

import { FIELD } from "../account/fields";
import { Banner, Button, cx, MonoLabel, Panel } from "../ui";

const COLOURS = [
  { key: "bg", label: "Background", hint: "Slide background" },
  { key: "text", label: "Text", hint: "Headlines and body" },
  { key: "accent", label: "Accent", hint: "Labels, bars, highlights" },
] as const;

/** How each deck font looks in the preview (the deck file uses DECK_FONT_FACE). */
const PREVIEW_FONT: Record<DeckFont, string> = { anton: "t-display uppercase", inter: "font-body font-bold", georgia: "font-bold [font-family:Georgia,serif]" };

export function BrandingSettings({ initial, saved, canEdit }: { initial: DeckBranding; saved: boolean; canEdit: boolean }) {
  const router = useRouter();
  const [b, setB] = useState(initial);
  const [hexText, setHexText] = useState<Record<string, string>>({ bg: initial.bg, text: initial.text, accent: initial.accent });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ratio = contrastRatio(b.bg, b.text);

  const setColour = (key: "bg" | "text" | "accent", value: string) => {
    setHexText({ ...hexText, [key]: value });
    const hex = normaliseHex(value);
    if (isHex(hex)) setB({ ...b, [key]: hex });
  };

  const readLogo = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const problem = logoProblem(dataUrl);
      if (problem) return setError(problem);
      const img = new Image();
      img.onload = () => setB({ ...b, logo: { dataUrl, width: img.naturalWidth, height: img.naturalHeight } });
      img.onerror = () => setError("That image could not be read.");
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/workspace/branding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ bg: b.bg, text: b.text, accent: b.accent, font: b.font, logo: b.logo }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return setError(((await res?.json().catch(() => null)) as { error?: string } | null)?.error ?? "That didn't work.");
    setNotice("Saved. Every deck this workspace exports now uses it.");
    router.refresh();
  };

  const reset = async () => {
    await fetch("/api/workspace/branding", { method: "DELETE" }).catch(() => null);
    setB({ ...DEFAULT_BRANDING, name: b.name });
    setHexText({ bg: DEFAULT_BRANDING.bg, text: DEFAULT_BRANDING.text, accent: DEFAULT_BRANDING.accent });
    setNotice("Back to Takeover's house deck.");
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-[18px]">
      {error && <Banner tone="err">{error}</Banner>}
      {notice && <Banner tone="info">{notice}</Banner>}
      {!canEdit && <Banner tone="neutral">Admins change the deck branding; your role can see it.</Banner>}
      <div className="grid items-start gap-[18px] lg:grid-cols-2">
        <Panel>
          <MonoLabel>Logo</MonoLabel>
          <label className={cx("relative flex items-center gap-4 rounded-md border-th border-dashed border-line bg-bg p-3.5", canEdit && "cursor-pointer")}>
            <input type="file" accept="image/png,image/jpeg" disabled={!canEdit} aria-label="Logo file" className="absolute h-px w-px opacity-0" onChange={(e) => readLogo(e.target.files?.[0])} />
            <span className="flex h-12 w-16 flex-none items-center justify-center rounded-btn bg-track">
              {b.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data URL the user chose, not a remote image
                <img src={b.logo.dataUrl} alt="Logo preview" className="max-h-10 max-w-14 object-contain" />
              ) : (
                <span className="font-mono text-label text-mute">NONE</span>
              )}
            </span>
            <span className="flex flex-col">
              <span className="font-semibold">{b.logo ? "Change the logo" : "Upload a logo"}</span>
              <span className="text-chip text-mute">PNG or JPEG, transparent background, at least 400px wide, at most 300 KB.</span>
            </span>
          </label>
          {b.logo && canEdit && (
            <div>
              <Button onClick={() => setB({ ...b, logo: null })}>Remove logo</Button>
            </div>
          )}
          <MonoLabel>Colours</MonoLabel>
          {COLOURS.map((c) => (
            <div key={c.key} className="flex items-center gap-3">
              <input type="color" value={b[c.key]} disabled={!canEdit} onChange={(e) => setColour(c.key, e.target.value)} aria-label={c.label} className="h-11 w-11 cursor-pointer rounded-btn border-th border-line bg-bg p-1" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span>{c.label}</span>
                <span className="text-chip text-mute">{c.hint}</span>
              </span>
              <input value={hexText[c.key]} disabled={!canEdit} onChange={(e) => setColour(c.key, e.target.value)} aria-label={`${c.label} hex`} className={cx(FIELD, "w-28 font-mono uppercase")} />
            </div>
          ))}
          <label className="flex flex-col gap-1.5">
            <MonoLabel>Headline font</MonoLabel>
            <select value={b.font} disabled={!canEdit} onChange={(e) => setB({ ...b, font: e.target.value as DeckFont })} aria-label="Headline font" className={cx(FIELD, "cursor-pointer")}>
              {DECK_FONTS.map((f) => (
                <option key={f} value={f}>
                  {DECK_FONT_LABEL[f]}
                </option>
              ))}
            </select>
          </label>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" loading={busy} onClick={() => void save()} className="min-h-[44px] px-4">
                Save branding
              </Button>
              <Button onClick={() => void reset()} disabled={!saved} className="min-h-[44px] px-4">
                Reset to Takeover
              </Button>
            </div>
          )}
        </Panel>
        <section className="flex flex-col gap-2" aria-label="Slide preview">
          <div className="flex justify-between">
            <MonoLabel>Slide preview</MonoLabel>
            <MonoLabel>16:9</MonoLabel>
          </div>
          {/* The workspace's own colours, as its decks will use them. */}
          <div className="flex aspect-video flex-col justify-between rounded-md p-[6%_7%]" style={{ background: b.bg, color: b.text }} data-preview>
            <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.08em]">
              {b.logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- a data URL the user chose, not a remote image
                <img src={b.logo.dataUrl} alt="" className="max-h-7 max-w-[40%] object-contain" />
              ) : (
                <span>{b.name}</span>
              )}
              <span>Pitch · a brand</span>
            </div>
            <div className="flex flex-col gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.08em]" style={{ color: b.accent }}>
                Why this pair
              </span>
              <span className={cx("max-w-[18ch] text-[clamp(18px,4vw,40px)] leading-[0.95]", PREVIEW_FONT[b.font])}>Your headline in this font</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="h-1.5 flex-1 overflow-hidden rounded-pill" style={{ background: `${b.text}33` }}>
                <span className="block h-full w-3/4 rounded-pill" style={{ background: b.accent }} />
              </span>
              <span className="font-mono text-[10px]">Sample bar · Qloo signal</span>
            </div>
          </div>
          <span className={cx("font-mono text-chip", ratio < MIN_CONTRAST ? "text-warn" : "text-mute")} role="status" data-contrast>
            {ratio < MIN_CONTRAST
              ? `Text on background is ${ratio.toFixed(1)}:1. Use at least ${MIN_CONTRAST}:1 so slides stay readable on projectors.`
              : `Text contrast ${ratio.toFixed(1)}:1 · passes AA`}
          </span>
        </section>
      </div>
    </div>
  );
}
