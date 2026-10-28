import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

/** Outcomes: plan, log results after the event, compare with the frozen predictions, report and export. */

const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `otto.${run}@e2e.test`;

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "A sign-in link is on its way" })).toBeVisible();
  await page.goto("/dev/outbox");
  const href = await page.locator(`[data-outbox-to="${email}"]`).first().locator("[data-outbox-link]").first().getAttribute("href");
  await page.goto(href!);
  await expect(page).toHaveURL(/\/workspace/);
}

test("log results on a plan, see predicted vs actual, and the workspace report", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, EMAIL);

  await test.step("an empty report until there is a plan", async () => {
    await page.goto("/workspace/outcomes");
    await expect(page.getByRole("heading", { name: "No outcomes yet" })).toBeVisible();
  });

  await test.step("plan, then log results from the plan's page", async () => {
    await page.goto("/run?q=Phoebe%20Bridgers");
    await expect(page.getByText("Complete · 7 / 7")).toBeVisible({ timeout: 45_000 });
    await page.getByRole("link", { name: /^Saved to / }).click();
    await page.getByRole("main").getByRole("link", { name: /Phoebe Bridgers ×/ }).first().click();
    await page.getByRole("link", { name: "Log results →" }).click();
    await expect(page.getByRole("tab", { name: "Log results", selected: true })).toBeVisible();
    await page.getByLabel("Tickets sold").fill("1,790");
    await page.getByLabel("Attendance").fill("1700");
    await page.getByRole("button", { name: "Save and compare" }).click();
    // Sell-through needs capacity too.
    const table = page.getByRole("table", { name: "Predicted vs actual" });
    await expect(table.locator('[data-line="City"]')).toContainText("Needs tickets sold and capacity");
    await expect(table.locator('[data-line="City"]')).toContainText(/#1 of \d+ · \d+ \/ 100/);
  });

  await test.step("add capacity: sell-through appears, judged against too few events", async () => {
    await page.getByRole("tab", { name: "Log results" }).click();
    await page.getByLabel("Sellable capacity").fill("1850");
    await page.getByRole("tab", { name: "Yes" }).click();
    await page.getByRole("button", { name: "Save and compare" }).click();
    await expect(page.getByText("97%").first()).toBeVisible();
    const table = page.getByRole("table", { name: "Predicted vs actual" });
    await expect(table.locator('[data-line="City"]')).toContainText("97% sell-through (1,790 of 1,850)");
    await expect(table.locator('[data-line="City"]')).toContainText("Too few events to judge (1 of 5)");
    await expect(table.locator('[data-line="Top sponsor"]')).toContainText("Renewed");
  });

  await test.step("the workspace report says too few events, and exports", async () => {
    await page.goto("/workspace/outcomes");
    await expect(page.getByText(/Too few events to judge: 1 of the 5 needed/)).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export CSV" }).click();
    const csv = readFileSync((await (await download).path())!, "utf8");
    expect(csv).toContain("tickets_sold_your_data");
    expect(csv).toContain("1790,1850,97%");
    expect(csv).toContain("too few events to judge");
  });
});
