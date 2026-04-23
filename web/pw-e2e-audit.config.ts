import { defineConfig } from "@playwright/test";

import { DEFAULT_BASE_URL, envFlag } from "./e2e/_support/runtime";

const auditDomains = [
  "smoke",
  "public",
  "auth",
  "user",
  "provider",
  "admin",
  "chat",
  "matching",
  "migration",
  "ui-audit",
];

export default defineConfig({
  testDir: "./e2e",
  testMatch: auditDomains.map((domain) => `${domain}/**/*.spec.ts`),
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: "playwright-report/e2e-audit" }],
  ],
  use: {
    baseURL: DEFAULT_BASE_URL,
    headless: true,
    viewport: { width: 1400, height: 900 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: envFlag("PLAYWRIGHT_SKIP_WEBSERVER")
    ? undefined
    : {
        command: "npm run dev",
        url: DEFAULT_BASE_URL,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
