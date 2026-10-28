import { expect, test, type Page } from "@playwright/test";

/**
 * Roster intelligence, signed in through the local outbox: create a roster, add five acts (one
 * through the picker for an ambiguous name), see the budget before refreshing, see the
 * pairings, and open a pair as a plan.
 */

const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `rosa.${run}@e2e.test`;
const ACTS = ["Ali Wong", "Hasan Minhaj", "Taylor Tomlinson", "Atsuko Okatsuka"];

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

test("create a roster, add five acts, see pairings, open a pair as a plan", async ({ page }) => {
  test.setTimeout(180_000);
  await signIn(page, EMAIL);

  await test.step("create a roster from the empty state", async () => {
    await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Rosters" }).click();
    await expect(page.getByRole("heading", { name: "No rosters yet" })).toBeVisible();
    await page.getByRole("textbox", { name: "Roster name" }).fill("North Star comedy");
    await page.getByRole("button", { name: "Create roster" }).click();
    await expect(page).toHaveURL(/\/workspace\/rosters\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("heading", { level: 1, name: "North Star comedy" })).toBeVisible();
  });

  await test.step("add four acts by name and one through the picker", async () => {
    const box = page.getByRole("textbox", { name: "Add an act" });
    for (const name of ACTS) {
      await box.fill(name);
      await box.press("Enter");
      await expect(page.locator(`[data-act="${name}"]`)).toBeVisible();
    }
    await box.fill("Mercury");
    await box.press("Enter");
    await expect(page.getByText("Found 2 matches for “Mercury”, which one?")).toBeVisible();
    await page.getByRole("option").first().click();
    await expect(page.locator("[data-act]")).toHaveCount(5);
    await expect(page.getByText(/^5 acts/)).toBeVisible();
    await expect(page.getByText("Not scored yet · refresh to score with Qloo")).toHaveCount(5);
  });

  await test.step("see what the refresh will use, then run it", async () => {
    const bar = page.getByLabel("Refresh");
    await expect(bar.getByText(/To refresh: 5 acts: .* up to \d+ Qloo calls\./)).toBeVisible();
    await expect(bar.getByText(/of 500 Qloo calls left this month/)).toBeVisible();
    await bar.getByRole("button", { name: /^Refresh · \d+ calls$/ }).click();
    await expect(page.getByText("Not scored yet · refresh to score with Qloo")).toHaveCount(0, { timeout: 30_000 });
    await expect(bar.getByText(/Everything is up to date/)).toBeVisible({ timeout: 30_000 });
  });

  let pair = "";
  await test.step("see the pairings, ranked, with Qloo evidence", async () => {
    const cards = page.locator("[data-pair]");
    await expect(cards).toHaveCount(10);
    pair = (await cards.first().getAttribute("data-pair"))!;
    await expect(cards.first().getByRole("meter")).toBeVisible();
    await expect(cards.first().getByText(/fans over-index on/).first()).toBeVisible();
    await expect(page.getByText(/It is not a share of fans/)).toBeVisible();
  });

  await test.step("open a pair as a plan, with the partner kept", async () => {
    const [a, b] = pair.split(" + ");
    await page.locator(`[data-pair="${pair}"]`).getByRole("button", { name: "Plan this pairing" }).click();
    await expect(page).toHaveURL(/\/run\?.*entity=.*partner=.*pc=/);
    expect(new URL(page.url()).searchParams.get("q")).toBe(a);
    await expect(page.getByText("Complete · 7 / 7")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(b, { exact: false }).first()).toBeVisible();
  });
});

test("a signed-out visitor is sent to sign in from rosters", async ({ page }) => {
  await page.goto("/workspace/rosters");
  await expect(page).toHaveURL(/\/signin\?next=(%2F|\/)workspace(%2F|\/)rosters/);
});
