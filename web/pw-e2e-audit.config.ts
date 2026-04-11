import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  timeout: 600_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: "http://localhost:3000",
    headless: false,
    viewport: { width: 1400, height: 900 },
    screenshot: "on",
    video: "on",
  },
});
