# Handoff: Takeover

## Overview
Takeover plans a "takeover" event for a talent: it finds a crossover partner, the city where both audiences over-index, a room and sponsors, then writes a brief and outreach drafts. Every pick is backed by Qloo taste data.

Screens: Landing → Run (live agent log + results canvas) → Crossover result → Results (City, Room & sponsors, Brief, Outreach) + Edge states.

## About the design files
`reference/*.dc.html` are **design references built in HTML**. They are prototypes that show the intended look and behaviour, not production code. Rebuild them in the target codebase using its existing patterns. `src/` is a React + Tailwind translation to start from. It uses the same tokens, components and copy as the references.

## Fidelity
**High fidelity.** Colours, type, spacing, radii and copy are final. Keep the copy text exactly as written in `src/`. Sample data (Ali Wong, Hot Ones, cities, venues, openers, spots) is placeholder until Qloo responses are wired in. Opener and after-show spot names are fictional.

## Setup
1. Import `tokens.css` once at the app root. It loads the fonts and defines every CSS variable.
2. Use `tailwind.config.js`. Every colour, font and radius maps to a CSS variable, so switching theme only needs `<html data-theme="dark | light">`. The default is dark.
3. Use the `t-display` class for Anton. Add a size utility next to it.

## Decisions (final)
- **Accent set 1b** (Lime / Anton) is the only accent. 1a and 1c have been removed.
- **Themes:** dark and light only. Gen Z has been removed.
- **Results rule everywhere:** capacity, dates and price never appear as numbers. They only appear as "to confirm with promoter" pills (Capacity, Dates, Price).
- **Lime in light mode:** `--acc` (#c6f02a) is only a fill behind dark text (primary button, "Use this…" hover). Accent text uses `--acc-text` (#4d6300). Thin accents (dots, active borders, score and progress bars, legend swatches, info-banner border) use `--acc-line` (#6b8a00).
- **Anton only for headlines (24px and up), the wordmark and big numbers.** Smaller entity names (picker rows, shortlist cards) use Inter 600. Body, labels and buttons stay in Inter or JetBrains Mono.
- **Error colour:** `--err` dark #f2706a, light #b3261e. It is red rather than amber, so it is clearly distinct from `--warn`.

## Design tokens
**Dark:** bg #161826 · surf #232532 · line #3f424d · ink #e9e9ed · mute #9397ab · track #292b31 · warn #e8b04a · err #f2706a · acc #d4ff3a · on-acc #161826 · acc-text #d4ff3a · acc-line #d4ff3a · acc-soft #2c3313

**Light:** bg #f3f5fe · surf #fbfbff · line #cfd3e5 · ink #161826 · mute #595d6c · track #e4e7f5 · warn #9a6500 · err #b3261e · acc #c6f02a (fill only) · on-acc #161826 · acc-text #4d6300 · acc-line #6b8a00 · acc-soft #eef8c8

**Contrast (WCAG 2.1 AA):**
- Dark mode: err text 6.4:1 on bg and 5.4:1 on surf. acc-text 15:1 on bg.
- Light mode: err text 6.0:1 on bg and 6.4:1 on surf. acc-text 6.3–6.7:1 on bg/surf and 5.7:1 on acc-soft. acc-line 3.9:1 on surf and 3.2:1 on track, which meets the 3:1 non-text minimum. Ink on the lime fill is 14:1.

**Fonts:** Anton 400, uppercase, 0.005em for display. Inter 400/500/600 for body. JetBrains Mono for numbers, scores, sources, table headers and labels, with tabular figures (`.tabular`).

**Type scale:**
- Score: 64/0.8
- Headline: 52, line-height 0.92, balanced
- Section and card headlines: 24–44
- Wordmark: 22/1
- Small entity name: Inter 600, 16–18
- Body: 14/1.5
- Chip: 12/1.5
- Mono label: 10.5–11 uppercase, 0.06–0.08em

**Spacing:** 2.8 · 5.6 · 8.4 · 11.2 · 16.8 · 22.4. Panels have 22px padding, sections 18px gaps, groups 6–8px.

**Radius:** badge 4 · button 6 · input/card 8 · panel 14 · pill 99. A promoter pill that wraps onto two lines uses a 12px radius.

**Motion:**
- Skeleton pulse: 1.8s
- Running-step dot: 1s
- Score bar: 500ms
- Replan dim: 250ms to opacity .45

**Print:** the brief page is always light (`--paper` tokens) and is the only element that prints.

## Components (`src/components/ui.tsx`)
- **AppHeader**: `context?`, `right?`. Wordmark, mono context, right-aligned slot. Bottom rule.
- **Panel**: large surface (14 radius, 22 padding). 
- **Card**: `inset?`. 8-radius surface. Inset cards use `--bg` with a `--line` border.
- **Button**: `variant: primary | secondary | pick`. States: hover (primary brightens; secondary tints `--acc-soft`; pick fills `--acc`), disabled (opacity .55).
- **Segmented**: `options`, `value`, `onChange`, `mono?`. Active tab: `--surf` fill, ink text. Inactive tab: `--mute` text.
- **InputBar**: `value`, `onChange`, `onSubmit`, `placeholder`, `size: lg | md`, `buttonLabel`. The primary button sits inside the field.
- **Chip**: `kind?`, `label`, `onClick`. Hover tints to `--acc-soft`.
- **SourceBadge**: `children` (default "Qloo signal"). Leading ◆.
- **NoSourceBadge**: outlined "No source". Used in the LLM-only view.
- **ConfirmPill**: dashed `--warn` pill. Single line, truncates with an ellipsis.
- **OutlineChip**: static summary chip.
- **ScoreBar**: `value | null`, `fill: acc | mute`, `label?`. Shows "NN / 100", or "—" when value is null.
- **EntityCard**: `role?`, `name`, `meta`, `badges?`, `size`, `inset?`.
- **Banner**: `tone: info | warn | err | neutral`, `action?`. Full-width `--surf` strip with a 1px border in the state colour. Text stays `--ink`.
- **Skeleton / Sk.***: `--track` blocks at real sizes and radii, pulsing.
- **DataTable + Num**: mono uppercase header, 1px row rules, right-aligned mono numbers. The top value uses `--acc-text`.
- **DotMap + Legend**: positioned score dots (schematic, swap in a real map). Strongest or chosen point uses `--acc` and optionally a soft ring.
- **EmailCard**: `to`, `subject`, `body[]`, `copied`, `onCopy`, `mailto`. Buttons: Copy (shows "Copied" for 1.5s) and Open in mail (`mailto:` with no recipient).
- **StepCard**: `step: StepData`, `showBranch`, `open`, `onToggle`, `onRetry`. States:
  - waiting: hollow dot, opacity .55
  - running: pulsing `--acc` dot, `--acc` border, live mono text
  - done: decision line plus a collapsible "◆ Qloo call" row with endpoint and params
  - fallback: `--warn` border and a dashed "Fallback used" box with one sentence
  - error: `--err` border, message and "Retry step"
  - branch: a `--acc-soft` "↳ Branch" row (e.g. "No partner above the threshold, widening the search")
- **useCopy**: clipboard helper that sets a `copied` key for 1.5s.

## Screens
- **Landing** (`Landing.tsx`): wordmark, pitch headline, large input "Plan a takeover for…", four example chips that fill the input, three step cards (Crossover → City → Plan & brief), and the Qloo line with a source badge. Max width 880.
- **Run** (`Run.tsx`): header shows status and Replay.
  - Desktop (≥768px): grid with a 2fr log column and a 3fr canvas column.
  - Mobile: the log collapses into a progress card ("N / 7", current step, 8px bar, Show/Hide log toggle).
  - The canvas fills in order: crossover → map → room & sponsors → brief → outreach. Each section shows a skeleton until its step finishes.
  - `scenario`: `fallback` (step 3 branches and falls back), `clean`, or `error` (step 5 errors; the room section shows an error banner; Retry restarts step 5).
  - `useRunSim` stands in for the agent event stream. Replace it with real events and keep the `StepStatus` mapping.
- **Crossover** (`Crossover.tsx`):
  - Hero: fanbase and partner entity cards, shared-audience score bar, format, and "why this pair" with a source badge.
  - Shortlist: two smaller cards with "Use this partner". Clicking dims the hero, reads "Replanning with X…", then swaps the partner.
  - Segmented "With Qloo | LLM only". LLM-only swaps in generic copy, removes scores ("Not measured") and sources ("No source"), neutralises the accent, and hides replan buttons.
- **Results** (`Results.tsx`):
  - City: dot map, legend, score explainer, ranked list with "Use this city", and the "With Qloo rank vs population rank" table.
  - Room & sponsors: venue and local opener cards, 3 after-show spots and 3 sponsors, each with a Qloo badge. Capacity, dates and price only appear as "to confirm with promoter" pills.
  - Brief: a printable Letter or A4 page. Each pick shows its reason and source. Buttons: Download PDF (`window.print`), Copy as text, Copy link (`#brief`).
  - Outreach: two email cards and the note "Drafts only. Takeover never sends email."
  - Changing the city replans sections 2–4 and shows an info banner while it runs.
- **Edge states** (`States.tsx`), each exported on its own:
  - a `EntityPicker`: radio list with image placeholder, category badge and a disambiguating detail.
  - b `NoMatch`: "We couldn't find that fanbase" plus three spelling chips.
  - c `ThinData`: warn banner and a region-level map.
  - d `NearestCity`: warn banner and a substituted venue labelled "Nearest city · not Boise".
  - e `ApiBusy`: info banner, 8s countdown that unlocks Retry, and cached example chips.
  - f `*Skeleton`: one skeleton per results section.

## Responsive
Every component reflows at 380px. Grids use `repeat(auto-fit, minmax(min(Npx,100%),1fr))` or `minmax(0,1fr)` tracks, with no fixed widths. Display sizes use `clamp()`.

## Files
- `tokens.css`: all CSS variables, fonts, `.t-display`
- `tailwind.config.js`
- `src/components/ui.tsx`
- `src/screens/Landing.tsx`, `Run.tsx`, `Crossover.tsx`, `Results.tsx`, `States.tsx`
- `screens/`: 52 PNGs named `<screen>-<state>-<width>-<theme>.png`. Widths are 1280 and 380, themes are dark and light. Screens and states: landing-default · run-running, run-complete, run-error · crossover-withqloo, crossover-llmonly · results-default · states-multiple-matches, no-match, thin-data, no-venues, api-busy, loading.
- `reference/`: the HTML prototypes (Landing, Run, Crossover, Results, States). Open them in a browser to see behaviour.
