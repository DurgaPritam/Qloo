/**
 * UI rows of the Step 7 matrix against a running app on real data: swap partner and city (only
 * downstream steps rerun), 380px mobile, brief export (copy, print layout, link in a private window).
 *
 *   MATRIX_URL=http://localhost:3400 MATRIX_TOKEN=… npx tsx scripts/matrix-ui.mts
 */
import { chromium } from "playwright";

const BASE = process.env.MATRIX_URL ?? "http://localhost:3400";
const headers = { "x-takeover-e2e": process.env.MATRIX_TOKEN ?? "" };
const ok = (m: string) => console.log(`✓ ${m}`);
const bad = (m: string) => console.log(`✗ ${m}`);
const report = (pass: boolean, good: string, fail: string) => (pass ? ok(good) : bad(fail));

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: headers });
await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
const page = await ctx.newPage();
const complete = () => page.waitForSelector("text=Complete · 7 / 7", { timeout: 90_000 });

await page.goto(`${BASE}/run?q=${encodeURIComponent("John Mulaney")}`);
await complete();

// Swap partner: steps 01–02 must never leave "done".
await page.evaluate(() => {
  const w = window as unknown as { __seen: Record<string, string[]> };
  w.__seen = { "01": [], "02": [], "03": [], "04": [] };
  setInterval(() => {
    for (const n of Object.keys(w.__seen)) {
      const s = document.querySelector<HTMLElement>(`[data-step="${n}"]`)?.dataset.status;
      if (s && w.__seen[n].at(-1) !== s) w.__seen[n].push(s);
    }
  }, 10);
});
await page.getByRole("button", { name: "Use this partner" }).first().click();
await page.waitForTimeout(500);
await complete();
let seen = await page.evaluate(() => (window as unknown as { __seen: Record<string, string[]> }).__seen);
report(
  seen["01"].join() === "done" && seen["02"].join() === "done" && seen["03"].length > 1,
  `swap partner reran only steps 3–7 (step 3 went ${seen["03"].join(" → ")})`,
  `swap partner: ${JSON.stringify(seen)}`,
);

// Swap city: steps 01–03 must never leave "done".
await page.evaluate(() => {
  const w = window as unknown as { __seen: Record<string, string[]> };
  for (const n of Object.keys(w.__seen)) w.__seen[n] = [];
});
await page.getByRole("button", { name: "Use this city" }).first().click();
await page.waitForTimeout(500);
await complete();
seen = await page.evaluate(() => (window as unknown as { __seen: Record<string, string[]> }).__seen);
report(["01", "02", "03"].every((n) => seen[n].join() === "done") && seen["04"].length > 1, "swap city reran only steps 4–7", `swap city: ${JSON.stringify(seen)}`);

// Brief export.
await page.getByRole("button", { name: "Copy as text" }).click();
const text = await page.evaluate(() => navigator.clipboard.readText());
report(/Takeover brief/.test(text) && !/(capacit\w*|prices?|dates?)\W{0,3}\d/i.test(text), "brief copies as text, no numbers by capacity/price/date", "brief text");
await page.emulateMedia({ media: "print" });
const printed = await page.evaluate(() => [...document.querySelectorAll("section,article")].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.tagName + (e.id ? `#${e.id}` : "")).join(" "));
report(printed.includes("SECTION#brief") && printed.includes("ARTICLE") && !printed.includes("Agent log"), `print shows only the brief (${printed})`, `print: ${printed}`);
await page.emulateMedia({ media: "screen" });
await page.getByRole("button", { name: "Copy link" }).click();
const link = await page.evaluate(() => navigator.clipboard.readText());
const privateCtx = await browser.newContext();
const shared = await privateCtx.newPage();
await shared.goto(link);
report(
  (await shared.getByText("Shared plan").count()) > 0,
  `share link opens in a private window (${link.replace(BASE, "")})`,
  `share link: ${link}`,
);
await privateCtx.close();

// Mobile 380px.
const mobile = await browser.newContext({ viewport: { width: 380, height: 800 }, extraHTTPHeaders: headers });
const m = await mobile.newPage();
await m.goto(`${BASE}/run?q=${encodeURIComponent("Arsenal")}`);
await m.waitForSelector("text=Complete · 7 / 7", { state: "attached", timeout: 90_000 });
const width = await m.evaluate(() => document.documentElement.scrollWidth);
const logHidden = await m.locator('[data-step="01"]').isHidden();
report(width <= 380 && logHidden, "380px: no horizontal scroll, log collapsed into progress bar", `380px: width ${width}, log hidden ${logHidden}`);
await m.screenshot({ path: "/tmp/takeover-arsenal-380.png", fullPage: true });
await browser.close();
