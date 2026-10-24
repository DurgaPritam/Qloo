import { expect, test, type Page } from "@playwright/test";

import { EXAMPLES } from "../lib/examples";

const complete = (page: Page) => expect(page.getByText("Complete · 7 / 7")).toBeVisible({ timeout: 45_000 });
const run = (page: Page, q: string) => page.goto(`/run?q=${encodeURIComponent(q)}`);

/** Name of the chosen partner in the crossover hero. */
const heroPartner = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll("div")]
        .find((d) => d.textContent?.trim() === "Partner" && d.className.includes("font-mono"))
        ?.parentElement?.querySelector(".t-display")?.textContent ?? "",
  );

test.describe("landing examples", () => {
  for (const example of EXAMPLES) {
    test(`"${example.name}" completes from one click`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("button", { name: new RegExp(example.name) }).click();
      await expect(page).toHaveURL(/\/run\?q=/);
      await complete(page);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(example.name, { ignoreCase: true });
      for (const step of ["01", "03", "04", "05"]) {
        await expect(page.locator(`[data-step="${step}"]`).getByText("◆ Qloo call")).toBeVisible();
      }
      await expect(page.getByText("Drafts only. Takeover never sends email.")).toBeVisible();
    });
  }
});

test("a misspelling shows suggestions and resumes on click", async ({ page }) => {
  await run(page, "Kevn Hart");
  await expect(page.getByRole("heading", { name: "We couldn't find that fanbase" })).toBeVisible();
  await expect(page.getByText("Did you mean one of these?")).toBeVisible();
  await page.getByRole("button", { name: /Kevin Hart/ }).click();
  await complete(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Kevin Hart", { ignoreCase: true });
});

test("an ambiguous name shows the picker with category", async ({ page }) => {
  await run(page, "Mercury");
  const picker = page.getByRole("radiogroup");
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("radio")).toHaveCount(2);
  await expect(picker.getByText("Film", { exact: true })).toBeVisible();
  await picker.getByRole("radio").nth(1).click();
  await page.getByRole("button", { name: /Plan with/ }).click();
  await complete(page);
  await expect(page.getByText("Format · screening tour")).toBeVisible();
});

test("nonsense shows no-match with examples", async ({ page }) => {
  await run(page, "asdfgh");
  await expect(page.getByRole("heading", { name: "We couldn't find that fanbase" })).toBeVisible();
  for (const example of EXAMPLES) await expect(page.getByRole("button", { name: new RegExp(example.name) })).toBeVisible();
});

test("swapping the partner reruns only the downstream steps", async ({ page }) => {
  await run(page, EXAMPLES[0].name);
  await complete(page);
  const before = await heroPartner(page);

  // Record every status steps 01–03 pass through after the click.
  await page.evaluate(() => {
    const w = window as unknown as { __seen: Record<string, string[]> };
    w.__seen = { "01": [], "02": [], "03": [] };
    setInterval(() => {
      for (const n of Object.keys(w.__seen)) {
        const s = document.querySelector<HTMLElement>(`[data-step="${n}"]`)?.dataset.status;
        if (s && w.__seen[n].at(-1) !== s) w.__seen[n].push(s);
      }
    }, 10);
  });
  await page.getByRole("button", { name: "Use this partner" }).first().click();
  await expect(page.locator('[data-step="07"][data-status="done"]')).toBeVisible();
  await complete(page);

  const seen = await page.evaluate(() => (window as unknown as { __seen: Record<string, string[]> }).__seen);
  expect(seen["01"]).toEqual(["done"]);
  expect(seen["02"]).toEqual(["done"]);
  expect(seen["03"]).not.toEqual(["done"]);
  expect(await heroPartner(page)).not.toBe(before);
});

test("the brief has no digits next to capacity, price or date", async ({ page }) => {
  await run(page, EXAMPLES[1].name);
  await complete(page);
  const brief = await page.locator("#brief article").innerText();
  expect(brief).toContain("to confirm with the promoter");
  expect(brief).not.toMatch(/(capacit\w*|prices?|dates?)\W{0,3}\d|\d[\d,.]*\W{0,3}(capacit\w*|prices?|dates?)\b/i);
});

test("mailto links carry the encoded subject and body", async ({ page }) => {
  await run(page, EXAMPLES[2].name);
  await complete(page);
  const links = page.getByRole("link", { name: "Open in mail" });
  await expect(links).toHaveCount(2);
  for (const link of await links.all()) {
    const href = (await link.getAttribute("href")) ?? "";
    expect(href).toMatch(/^mailto:\?subject=[^\s&]+&body=[^\s&]+$/);
    const url = new URL(href);
    expect(url.searchParams.get("subject")?.length).toBeGreaterThan(5);
    expect(url.searchParams.get("body")).toContain("\n");
  }
});

test("the LLM-only toggle shows an unsourced answer", async ({ page }) => {
  await run(page, EXAMPLES[3].name);
  await complete(page);
  await page.getByRole("tab", { name: "LLM only" }).click();
  await expect(page.getByText("LLM only: what a plain chatbot guessed with no taste data.")).toBeVisible();
  await expect(page.getByText("Not measured")).toBeVisible();
  await expect(page.getByText("No source", { exact: true })).toBeVisible();
});

test("mock mode always shows the sample-data banner", async ({ page }) => {
  const health = await (await page.request.get("/api/health")).json();
  test.skip(!health.mock, "Deployment is not in mock mode");
  for (const path of ["/", "/run?q=Mercury"]) {
    await page.goto(path);
    await expect(page.getByText("SAMPLE DATA — not Qloo results")).toBeVisible();
  }
});

test("@mobile the log collapses into a progress bar at 380px", async ({ page }) => {
  await run(page, EXAMPLES[0].name);
  await expect(page.getByText("Complete · 7 / 7")).toBeAttached({ timeout: 45_000 });
  await expect(page.locator('[data-step="01"]')).toBeHidden();
  await page.getByRole("button", { name: "Show log" }).click();
  await expect(page.locator('[data-step="01"]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(380);
});

test("going Back to the landing page leaves Plan takeover usable", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: new RegExp(EXAMPLES[3].name) }).click();
  await expect(page).toHaveURL(/\/run\?q=/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  const submit = page.getByRole("button", { name: "Plan takeover" }).filter({ visible: true });
  await expect(submit).toBeEnabled();
  await page.getByRole("textbox", { name: "Plan a takeover for…" }).filter({ visible: true }).fill(EXAMPLES[0].name);
  await submit.click();
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(EXAMPLES[0].name).replace(/%20/g, "(\\\\+|%20)")}`));
});
