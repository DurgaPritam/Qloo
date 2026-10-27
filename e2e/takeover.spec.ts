import { expect, test, type Page } from "@playwright/test";

import { EXAMPLES } from "../lib/examples";

/** An example chip ("Music artist Phoebe Bridgers"), not the overlap chips that also name it. */
const chip = (e: { kind: string; name: string }) => new RegExp(`^${e.kind}\\s*${e.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
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
      await page.getByRole("button", { name: chip(example) }).click();
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
  const picker = page.getByRole("radiogroup").filter({ hasText: "Mercury" });
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
  await page.getByRole("button", { name: chip(EXAMPLES[3]) }).click();
  await expect(page).toHaveURL(/\/run\?q=/);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  const submit = page.getByRole("button", { name: "Plan takeover" }).filter({ visible: true });
  await expect(submit).toBeEnabled();
  await page.getByRole("combobox", { name: "Plan a takeover for…" }).filter({ visible: true }).fill(EXAMPLES[0].name);
  await submit.click();
  await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(EXAMPLES[0].name).replace(/%20/g, "(\\\\+|%20)")}`));
});

test("the city map draws real geography and a tour route", async ({ page }) => {
  await run(page, EXAMPLES[1].name);
  await complete(page);
  const city = page.locator("section").filter({ hasText: "02 · City" }).last();
  await expect(city.locator("svg path").first()).toHaveAttribute("d", /^M/);
  await city.getByRole("tab", { name: "Tour route" }).click();
  await expect(city.getByText(/Tour route · \d+ stops · [\d,]+ km/)).toBeVisible();
  await expect(city.getByText("start", { exact: true })).toBeVisible();
  await expect(city.locator('svg path[stroke-dasharray]')).toHaveCount(1);
});

test("the shortlist comparison and both downloads work", async ({ page }) => {
  await run(page, EXAMPLES[0].name);
  await complete(page);
  await expect(page.getByText("Compare the shortlist")).toBeVisible();

  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download CSV" }).click()]);
  expect(csv.suggestedFilename()).toMatch(/\.csv$/);
  const text = await (await csv.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
  expect(text.split("\r\n")[0]).toContain("rank_with_qloo,population_rank,city");

  const [deck] = await Promise.all([
    page.waitForEvent("download", { timeout: 30_000 }),
    page.getByRole("button", { name: "Download deck" }).click(),
  ]);
  expect(deck.suggestedFilename()).toMatch(/\.pptx$/);
  const bytes = await (await deck.createReadStream()).toArray().then((c) => Buffer.concat(c));
  expect(bytes.subarray(0, 2).toString()).toBe("PK"); // a .pptx is a zip archive
  expect(bytes.length).toBeGreaterThan(20_000);
});

test("fan overlap scores a pair and links to both takeovers", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("textbox", { name: "First fanbase" }).fill("John Mulaney");
  await page.getByRole("textbox", { name: "Second fanbase" }).fill("Succession");
  await page.getByRole("button", { name: "Check overlap" }).click();
  await expect(page).toHaveURL(/\/overlap\?a=John/);
  await expect(page.getByText(/among John Mulaney fans/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Who the fans are", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: /Plan a takeover for John Mulaney/ })).toBeVisible();
});

test("search suggestions open a plan with the picked name", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("combobox", { name: "Plan a takeover for…" }).filter({ visible: true });
  // Two sample matches, so the list opens.
  await box.fill("Mercury");
  const option = page.getByRole("option").first();
  await expect(option).toBeVisible({ timeout: 10_000 });
  await option.click();
  await expect(page).toHaveURL(/\/run\?q=/);
});

test("the tour planner draws a route with every leg", async ({ page }) => {
  await page.goto("/tour?q=John%20Mulaney");
  await expect(page.getByText("Plan the opening takeover →")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("start", { exact: true })).toBeVisible();
  await expect(page.locator("svg path[stroke-dasharray]")).toHaveCount(1);
});

test("the Gen Z theme applies and survives a reload", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Gen Z" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "genz");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "genz");
  await expect(page.getByRole("radio", { name: "Gen Z" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("radio", { name: "Dark" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});
