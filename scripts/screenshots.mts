/**
 * README screenshots from a running app in real mode, using preloaded examples (replays cost no
 * Qloo or model calls; the LLM-only tab makes one model call the first time).
 *
 *   MATRIX_URL=http://localhost:3400 MATRIX_TOKEN=… npx tsx scripts/screenshots.mts
 */
import { chromium, type Page } from "playwright";

const BASE = process.env.MATRIX_URL ?? "http://localhost:3400";
const OUT = "docs/screenshots";
const headers = { "x-takeover-e2e": process.env.MATRIX_TOKEN ?? "" };

const browser = await chromium.launch();

async function open(width: number, height: number): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, extraHTTPHeaders: headers, colorScheme: "light" });
  return ctx.newPage();
}

async function runExample(page: Page, name: string) {
  await page.goto(BASE);
  await page.getByRole("button", { name: new RegExp(name) }).click();
  await page.getByText("Complete · 7 / 7").waitFor({ timeout: 90_000 });
  await page.waitForTimeout(800);
}

const desktop = await open(1280, 860);
await desktop.goto(BASE);
await desktop.waitForTimeout(800);
await desktop.screenshot({ path: `${OUT}/landing.png` });

await runExample(desktop, "Phoebe Bridgers");
if (await desktop.getByText("SAMPLE DATA").count()) throw new Error("Sample data on screen: is the app in mock mode?");
await desktop.screenshot({ path: `${OUT}/plan.png` });

const city = desktop.locator("section").filter({ hasText: "02 · City" }).last();
await city.scrollIntoViewIfNeeded();
await city.screenshot({ path: `${OUT}/city.png` });

const brief = desktop.locator("#brief");
await brief.scrollIntoViewIfNeeded();
await brief.screenshot({ path: `${OUT}/brief.png` });

await desktop.evaluate(() => window.scrollTo(0, 0));
const answered = desktop.waitForResponse((r) => r.url().includes("/api/llm-only"), { timeout: 90_000 });
await desktop.getByRole("tab", { name: "LLM only" }).click();
await answered;
await desktop.waitForTimeout(800);
await desktop.screenshot({ path: `${OUT}/llm-only.png` });

const mobile = await open(380, 800);
await runExample(mobile, "Arsenal");
await mobile.screenshot({ path: `${OUT}/mobile.png` });

await browser.close();
console.log("Saved landing, plan, city, brief, llm-only and mobile screenshots.");
