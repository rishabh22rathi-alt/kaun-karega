import { defineConfig } from "@playwright/test";

// Sandbox/QA override. Mirrors playwright.config.ts but forces headless
// so the suite can run from a non-interactive shell without launching
// browser windows on the user's desktop. Used only for one-shot QA runs;
// safe to delete.

export default defineConfig({
  testDir: "./",
  testMatch: ["tests/**/*.spec.ts", "e2e/**/*.spec.ts"],
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["line"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
    headless: true,
    viewport: { width: 1400, height: 900 },
    screenshot: "only-on-failure",
    video: "off",
    trace: "off",
  },
});
