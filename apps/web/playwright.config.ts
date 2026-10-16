import { defineConfig, devices } from "@playwright/test"
import { E2E } from "./e2e/env.mjs"

/**
 * Browser tests: a real API and the web app, against their own database (wallet_e2e) and Redis
 * database (1), on ports 4100 and 5174, so they never touch development data or a running dev
 * server. The API's start command first wipes and migrates that database (e2e/prepare.mjs).
 *
 *   npm run test:e2e            (from the repo root; Docker Postgres and Redis must be running)
 *   npm run test:e2e -- --ui    (watch the tests in Playwright's UI)
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // Each test drives a real browser against one API and a Vite dev server; more than two at once
  // overloads a typical laptop and tests time out for no real reason
  workers: 2,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: E2E.webUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // Locally, the installed Chrome (no download needed); CI installs Playwright's Chromium
    ...(process.env.CI ? {} : { channel: "chrome" }),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] }, grepInvert: /@phone/ },
    { name: "phone", use: { ...devices["Pixel 7"] }, grep: /@phone/ },
  ],
  webServer: [
    {
      // Fresh database and Redis first (webServer starts before any global setup would run)
      command: "node ../web/e2e/prepare.mjs && npx tsx src/server.ts",
      cwd: "../api",
      url: `${E2E.apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        NODE_ENV: "test", // no rate limits, no background workers
        PORT: String(E2E.apiPort),
        DATABASE_URL: E2E.databaseUrl,
        REDIS_URL: E2E.redisUrl,
        JWT_SECRET: "e2e-only-secret-not-used-anywhere-else-0123456789",
        CORS_ORIGINS: E2E.webUrl,
        APP_URL: E2E.webUrl,
        // Never call real services from tests, whatever the developer's shell has set
        RESEND_API_KEY: "",
        GEMINI_API_KEY: "",
        PAYSTACK_SECRET_KEY: "",
        LOG_LEVEL: "warn",
      },
    },
    {
      command: `npx vite --port ${E2E.webPort} --strictPort`,
      url: E2E.webUrl,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_URL: E2E.apiUrl },
    },
  ],
})
