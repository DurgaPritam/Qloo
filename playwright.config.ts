import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests. Locally they build and start the app in mock mode (sample data, no Qloo or
 * Anthropic calls). Set PLAYWRIGHT_BASE_URL to test a deployment instead, with TAKEOVER_E2E_TOKEN
 * matching the deployment's, and VERCEL_AUTOMATION_BYPASS_SECRET for protected previews.
 */
const remote = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = remote ?? "http://localhost:3200";
const token = process.env.TAKEOVER_E2E_TOKEN ?? (remote ? undefined : "local-e2e-token-not-a-secret");

const headers: Record<string, string> = {};
if (token) headers["x-takeover-e2e"] = token;
if (process.env.VERCEL_AUTOMATION_BYPASS_SECRET) {
  headers["x-vercel-protection-bypass"] = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
}

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    extraHTTPHeaders: headers,
    trace: "retain-on-failure",
    acceptDownloads: true,
    // The run tour opens once per browser; specs about other things start with it seen.
    // e2e/onboarding.spec.ts starts from empty storage.
    storageState: { cookies: [], origins: [{ origin: new URL(baseURL).origin, localStorage: [{ name: "tk.runTour.done", value: "1" }] }] },
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grepInvert: /@mobile/ },
    { name: "mobile", use: { ...devices["Desktop Chrome"], viewport: { width: 380, height: 800 }, hasTouch: true }, grep: /@mobile/ },
  ],
  webServer: remote
    ? undefined
    : {
        command: "npm run build && npx next start -p 3200",
        url: `${baseURL}/api/health`,
        // Sign-in needs a session secret; CI has no .env.local, so the local test server gets a throwaway one.
        env: { TAKEOVER_MOCK: "1", TAKEOVER_E2E_TOKEN: token ?? "", TAKEOVER_DB: "memory", AUTH_SECRET: process.env.AUTH_SECRET ?? "local-e2e-auth-secret-not-a-secret" },
        reuseExistingServer: !process.env.CI,
        timeout: 240_000,
      },
});
