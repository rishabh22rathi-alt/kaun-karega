/**
 * Kaun Karega QA — the single canonical test config.
 *
 * Replaces the broken `pw-e2e-audit.config.ts` reference (Option 1 from the
 * plan). Packs are defined as Playwright PROJECTS keyed by file-path globs, so
 * the ~120 existing specs are wired into packs WITHOUT editing a single one.
 * Run a pack with `--project=<name>` (see package.json test:kk:* scripts).
 *
 * Seed/reset live in the isolated `setup` project and never auto-run during a
 * pack — they are invoked explicitly and self-skip unless writes are allowed.
 *
 * Convention used by docs/qa/KAUN_KAREGA_REGULAR_TESTING_GUIDE.md.
 */

import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";
import * as path from "path";

// Populate process.env from .env.local then .env (does not override real env).
dotenv.config({ path: path.resolve(__dirname, ".env.local") });
dotenv.config({ path: path.resolve(__dirname, ".env") });

const HEADLESS = process.env.PLAYWRIGHT_HEADLESS !== "0";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000",
    headless: HEADLESS,
    viewport: { width: 1400, height: 900 },
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    // ── Seed / reset (isolated; never part of a pack run) ──────────────────
    { name: "setup", testMatch: ["kktest/**/*.spec.ts"] },

    // ── Packs (path-globbed; existing specs wired without edits) ───────────
    { name: "smoke", testMatch: ["smoke/**/*.spec.ts", "seo/**/*.spec.ts"] },
    {
      name: "user",
      testMatch: [
        "user/**/*.spec.ts",
        "public/**/*.spec.ts",
        "my-requests.spec.ts",
        "phase5-my-requests.spec.ts",
        "homepage-service-region-areas.spec.ts",
        "i-need-post-multi-area.spec.ts",
      ],
    },
    {
      name: "provider",
      testMatch: [
        "provider/**/*.spec.ts",
        "approval/**/*.spec.ts",
        "phase6-provider-dashboard.spec.ts",
        "provider-dashboard-performance-debug.spec.ts",
        "provider-dashboard-time-filter.spec.ts",
        "provider-job-requests.spec.ts",
        "provider-demand-insights.spec.ts",
        "provider-area-coverage.spec.ts",
        "provider-area-demand-performance.spec.ts",
        "provider-city-demand-category.spec.ts",
        "provider-service-coverage.spec.ts",
        "provider-service-reregistration.spec.ts",
      ],
    },
    {
      name: "matching",
      testMatch: [
        "matching/**/*.spec.ts",
        "provider-matching.spec.ts",
        "provider-plan-listing-matrix.spec.ts",
        "all-jodhpur-matching.spec.ts",
        "all-jodhpur-ui.spec.ts",
        "strict-region-matching.spec.ts",
        "blocked-provider-exclusion.spec.ts",
      ],
    },
    {
      name: "chat",
      testMatch: [
        "chat/**/*.spec.ts",
        "chat-*-cutover.spec.ts",
        "chat-notification-logs.spec.ts",
        "provider-response-flow.spec.ts",
        "respond-page-flow.spec.ts",
        "localhost-provider-respond.spec.ts",
        "whatsapp-chat-cta.spec.ts",
        "whatsapp-chat-cta-realflow.spec.ts",
      ],
    },
    {
      name: "notify",
      testMatch: [
        "notifications/**/*.spec.ts",
        "push-helpers.spec.ts",
        "native-push-devices.spec.ts",
        "native-push-job-matched.spec.ts",
        "native-push-test-route.spec.ts",
        "provider-first-message-notification.spec.ts",
        "whatsapp-notification-dispatch.spec.ts",
      ],
    },
    {
      name: "revenue",
      testMatch: [
        "payments/**/*.spec.ts",
        "admin-scheduled-plan-activation.spec.ts",
        "admin-provider-plan-growth.spec.ts",
      ],
    },
    { name: "admin", testMatch: ["admin/**/*.spec.ts", "admin-*.spec.ts"] },
    { name: "data", testMatch: ["data-integrity/**/*.spec.ts"] },
    {
      name: "security",
      testMatch: [
        "security/**/*.spec.ts",
        "security-critical-regression.spec.ts",
        "auth/**/*.spec.ts",
        "migration/**/*.spec.ts",
      ],
    },
    { name: "health", testMatch: ["health/**/*.spec.ts"] },
    { name: "release", testMatch: ["release/**/*.spec.ts"] },
  ],
});
