import { defineConfig, devices } from "@playwright/test";

/**
 * Browser journeys run against the real local stack (API, worker, provider,
 * sandbox and web). Start it with `pnpm dev` in another terminal. Playwright does
 * not start the chain or database itself, so a browser failure cannot be hidden
 * behind a mocked API.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 150_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000",
    // The stripped headless shell segfaults on some Linux hosts; the full
    // Chromium binary with new headless mode is the portable fallback.
    channel: "chromium",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 20_000,
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 360, height: 800 },
        isMobile: false,
        hasTouch: true,
      },
    },
  ],
});
