import { expect, test, type Page } from "@playwright/test";

/** Lineup optimizer: candidates for a plan's headliner, the user's budget and tiers, the bill added to the plan. */

const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `lena.${run}@e2e.test`;

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "A sign-in link is on its way" })).toBeVisible();
  await page.goto("/dev/outbox");
  const href = await page.locator(`[data-outbox-to="${email}"]`).first().locator("[data-outbox-link]").first().getAttribute("href");
  await page.goto(href!);
}

test("optimize a lineup inside a budget and add it to the plan", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, EMAIL);
  await page.goto("/run?q=John%20Mulaney");
  await expect(page.getByText("Complete · 7 / 7")).toBeVisible({ timeout: 45_000 });
  await page.getByRole("link", { name: /Saved to .*workspace/ }).click();
  await page.getByRole("main").getByRole("link", { name: /John Mulaney ×/ }).first().click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}$/);
  const planUrl = page.url();

  await page.goto("/workspace/lineup");
  await expect(page.getByRole("navigation", { name: "Tools" }).getByRole("link", { name: "Lineup optimizer" })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Find candidates" }).click();
  await expect(page.locator("[data-candidate]").first()).toBeVisible();
  const lineup = page.getByRole("region", { name: "Suggested lineup" });
  await expect(lineup.getByText("Enter your total budget and fee tiers to see the best bill.")).toBeVisible();

  await page.getByLabel("Total budget").fill("100000");
  await page.getByLabel("Tier A fee").fill("60000");
  await page.getByLabel("Tier B fee").fill("15000");
  await page.getByLabel("Tier C fee").fill("5000");
  await expect(lineup.locator("[data-slot]")).toHaveCount(3);
  await expect(lineup.locator('[data-slot="Headliner"]')).toContainText("John Mulaney");
  await expect(lineup.getByText("$90,000 of $100,000")).toBeVisible();

  // Too small a budget: the engine says so instead of inventing a bill.
  await page.getByLabel("Total budget").fill("50000");
  await expect(lineup.getByRole("status")).toContainText("No 3-act lineup fits a $50,000 budget");
  await page.getByLabel("Total budget").fill("100000");

  await page.getByRole("button", { name: "Add lineup to plan" }).click();
  await expect(page.getByText("Added to the plan. It shows on the plan's page.")).toBeVisible();
  await page.goto(planUrl);
  const saved = page.getByRole("region", { name: "Lineup" });
  await expect(saved.getByText("Lineup · from the optimizer")).toBeVisible();
  await expect(saved.getByText("$90,000 of $100,000", { exact: false })).toBeVisible();
});
