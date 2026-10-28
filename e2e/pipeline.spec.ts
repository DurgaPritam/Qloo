import { expect, test, type Page } from "@playwright/test";

/**
 * The outreach pipeline: a plan's two drafts go onto the board, one is edited and marked sent (the
 * history keeps what went out), the other moves by its menu. Takeover sends nothing.
 */

const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `pia.${run}@e2e.test`;

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "A sign-in link is on its way" })).toBeVisible();
  await page.goto("/dev/outbox");
  const href = await page.locator(`[data-outbox-to="${email}"]`).first().locator("[data-outbox-link]").first().getAttribute("href");
  await page.goto(href!);
}

test("a plan's drafts go onto the board, one is marked sent with its content logged, one is booked", async ({ page }) => {
  test.setTimeout(150_000);
  await signIn(page, EMAIL);

  await test.step("the board starts empty", async () => {
    await page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Pipeline" }).click();
    await expect(page.getByRole("heading", { name: "Nothing in the pipeline" })).toBeVisible();
  });

  await test.step("a workspace plan adds its two drafts, once", async () => {
    await page.goto("/run?q=Phoebe%20Bridgers");
    await expect(page.getByText("Complete · 7 / 7")).toBeVisible({ timeout: 45_000 });
    await page.getByRole("link", { name: /Saved to .*workspace/ }).click();
    await page.getByRole("main").getByRole("link", { name: /Phoebe Bridgers ×/ }).first().click();
    await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}$/);
    await page.getByRole("button", { name: "Add to pipeline" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Added 2 drafts to the pipeline." })).toBeVisible();
    await page.getByRole("button", { name: "Add to pipeline" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Already in the pipeline." })).toBeVisible();
  });

  await test.step("both cards are drafts on the board", async () => {
    await page.goto("/workspace/pipeline");
    await expect(page.getByRole("heading", { level: 1, name: "Outreach" })).toBeVisible();
    await expect(page.locator("[data-summary]")).toHaveText("2 outreach · 0 booked · 0 lost");
    await expect(page.getByRole("region", { name: "Drafted" }).locator("[data-card]")).toHaveCount(2);
  });

  await test.step("edit the partner draft, then mark exactly that version sent", async () => {
    const drafted = page.getByRole("region", { name: "Drafted" });
    await drafted.locator("[data-card]").filter({ hasText: "'s team" }).getByRole("button").click();
    const detail = page.getByRole("region", { name: /Outreach to .*'s team/ });
    await detail.getByRole("textbox", { name: "Email address" }).fill("events@partner.test");
    await detail.getByRole("textbox", { name: "Subject" }).fill("Phoebe Bridgers: a crossover night");
    await expect(detail.getByRole("button", { name: "I sent it" })).toBeDisabled();
    await detail.getByRole("button", { name: "Save draft" }).click();
    await expect(detail.getByRole("link", { name: "Open in mail" })).toHaveAttribute("href", /^mailto:events%40partner\.test\?subject=Phoebe%20Bridgers/);
    await detail.getByRole("button", { name: "I sent it" }).click();
    await expect(page.getByRole("region", { name: "Sent" }).locator("[data-card]")).toHaveCount(1);
    const history = page.getByRole("list", { name: "History" });
    await expect(history.getByText(/marked it sent/)).toBeVisible();
    await expect(history.getByText("“Phoebe Bridgers: a crossover night” to events@partner.test", { exact: false })).toBeVisible();
    await expect(detail.getByRole("textbox", { name: "Subject" })).toHaveCount(0);
  });

  await test.step("move the venue card by its menu", async () => {
    const venue = page.getByRole("region", { name: "Drafted" }).locator("[data-card]").first();
    const name = await venue.getAttribute("data-card");
    await venue.getByRole("combobox", { name: `Move ${name}` }).selectOption("booked");
    await expect(page.getByRole("region", { name: "Booked" }).locator("[data-card]")).toHaveCount(1);
    await expect(page.locator("[data-summary]")).toHaveText("2 outreach · 1 booked · 0 lost");
    await page.reload();
    await expect(page.getByRole("region", { name: "Booked" }).locator("[data-card]")).toHaveCount(1);
  });

  await test.step("track a card: contact, a past follow-up date shows overdue; comment; list view filters", async () => {
    await page.getByRole("region", { name: "Sent" }).locator("[data-card]").first().getByRole("button").click();
    const detail = page.getByRole("region", { name: /Outreach to / });
    await detail.getByRole("textbox", { name: "Contact name" }).fill("Dana");
    await detail.getByLabel("Follow up by").fill("2020-01-15");
    await detail.getByRole("button", { name: "Save tracking" }).click();
    await expect(page.getByRole("region", { name: "Sent" }).locator('[data-due="2020-01-15"]')).toHaveText("Overdue · due 2020-01-15");
    await detail.getByRole("textbox", { name: "Comment on this card" }).fill("Chasing on Monday");
    await detail.getByRole("button", { name: "Comment", exact: true }).click();
    await expect(detail.getByText("Chasing on Monday")).toBeVisible();
    await expect(detail.getByRole("combobox", { name: "Owner" })).toBeVisible();

    await page.getByRole("tab", { name: "List" }).click();
    const list = page.getByRole("region", { name: "Outreach list" });
    await expect(list.locator("[data-row]")).toHaveCount(2);
    await list.getByLabel("Overdue only").check();
    await expect(list.locator("[data-row]")).toHaveCount(1);
    await expect(list.locator("[data-row]").first()).toContainText("Dana");
    await page.getByRole("combobox", { name: "Owner" }).first().selectOption({ label: "My cards" });
    await expect(list.locator("[data-row]")).toHaveCount(1);
  });
});
