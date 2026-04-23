import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./",
  testMatch: [
    "tests/**/*.spec.ts",
    "e2e/**/*.spec.ts"
  ],
  timeout: 60_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
    headless: false,
    viewport: { width: 1400, height: 900 },
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
});
