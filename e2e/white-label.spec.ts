import { expect, test, type Page } from "@playwright/test";

/** White-label: a Pro workspace's brand on a shared plan, the widget snippets, and the widgets' strict CSP. */
const run = Math.random().toString(36).slice(2, 8);
const EMAIL = `wren.${run}@e2e.test`;

async function signIn(page: Page, email: string) {
  await page.goto("/signin");
  await page.getByRole("textbox", { name: "Email address" }).fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();
  await expect(page.getByRole("heading", { name: "A sign-in link is on its way" })).toBeVisible();
  await page.goto("/dev/outbox");
  const href = await page.locator(`[data-outbox-to="${email}"]`).first().locator("[data-outbox-link]").first().getAttribute("href");
  await page.goto(href!);
}

test("brand a shared plan, embed its city vote, and set up a custom domain", async ({ page, request }) => {
  test.setTimeout(120_000);
  await signIn(page, EMAIL);
  expect((await page.request.post("/api/dev/tier", { data: { tier: "pro" } })).ok()).toBe(true);

  // The workspace's colours (Branded decks) and a publicly shared plan.
  expect((await page.request.post("/api/workspace/branding", { data: { bg: "#ffffff", text: "#101010", accent: "#0044cc", font: "inter", logo: null } })).ok()).toBe(true);
  await page.goto("/run?q=Phoebe%20Bridgers");
  await expect(page.getByText("Complete · 7 / 7")).toBeVisible({ timeout: 45_000 });
  await page.getByRole("link", { name: /Saved to .*workspace/ }).click();
  await page.getByRole("main").getByRole("link", { name: /Phoebe Bridgers ×/ }).first().click();
  await expect(page).toHaveURL(/\/plan\/[0-9a-f-]{36}$/);
  const planId = page.url().split("/").pop()!;
  expect((await page.request.post("/api/workspace/visibility", { data: { planId, visibility: "public" } })).ok()).toBe(true);

  await page.goto(`/p/${planId}`);
  await expect(page.locator('[data-white-label="on"]')).toBeVisible();
  await expect(page.getByRole("link", { name: "Taste data from Qloo" })).toHaveAttribute("href", "https://www.qloo.com");

  await page.goto("/workspace/settings/white-label");
  await expect(page.locator('[data-snippet="vote"]')).toContainText(`/embed/vote/${planId}?w=w_`);
  await page.getByRole("textbox", { name: "Custom domain" }).fill("plans.wren-live.test");
  await page.getByRole("button", { name: "Save domain" }).click();
  await expect(page.locator("[data-txt]")).toContainText("TXT _takeover.plans.wren-live.test");
  await page.getByRole("textbox", { name: "Allowed sites" }).fill("https://www.wren-live.test");
  await page.getByRole("button", { name: "Save sites" }).click();
  await expect(page.getByText("Widgets can be embedded on 1 site(s) only.")).toBeVisible();

  const snippet = await page.locator('[data-snippet="vote"]').innerText();
  const src = new URL(snippet.match(/src="([^"]+)"/)![1]);
  const widget = await request.get(`${src.pathname}${src.search}`);
  expect(widget.status()).toBe(200);
  const csp = widget.headers()["content-security-policy"];
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("frame-ancestors https://www.wren-live.test");
  expect(widget.headers()["set-cookie"]).toBeUndefined();

  // The widget works in its own page under its CSP: a vote counts.
  await page.goto(`${src.pathname}${src.search}`);
  const first = page.getByRole("button").first();
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("[data-count]").first()).toHaveText("1");
});
