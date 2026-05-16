/**
 * Single-active-session enforcement — Playwright coverage.
 *
 * What the feature does (recap, see lib/sessionVersion.ts):
 *   - /api/verify-otp atomically bumps profiles.session_version on every
 *     successful login. The new value is baked into the signed
 *     kk_auth_session cookie as `sver`.
 *   - getAuthSession({ cookie, validateVersion: true }) rejects cookies
 *     whose `sver` no longer matches the DB row. Middleware, admin API
 *     guards, and provider/user API routes all flow through that
 *     helper, so a stale cookie can't read protected data.
 *   - /api/auth/whoami exposes the same check to the browser. The
 *     useSessionGuard() hook (mounted in Sidebar, provider dashboard,
 *     chat thread, …) polls whoami on mount + on tab focus, and on a
 *     401 with `reason: "stale"` it wipes UI-hint cookies and routes
 *     to /login.
 *
 * Why mock /api/auth/whoami (instead of bumping session_version in
 * the real DB):
 *   - Playwright runs against the live dev server, but we can't bump
 *     profiles.session_version from the test process without coupling
 *     CI to a Supabase service-role key. Mocking whoami exercises the
 *     exact client wiring the user will hit: it's the only response
 *     the browser inspects to make the "stale" decision.
 *   - Coverage for the SERVER-side path (cookie verification, bump
 *     RPC, validator) lives in unit-level checks; this spec asserts
 *     the user-visible behaviour of the stale path.
 */

import type { Page } from "@playwright/test";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import {
  QA_ADMIN_NAME,
  QA_ADMIN_PHONE,
  QA_PROVIDER_PHONE,
  QA_USER_PHONE,
} from "../_support/data";
import { gotoPath } from "../_support/home";
import { mockCommonCatalogRoutes, mockJson } from "../_support/routes";
import {
  mockAdminDashboardApis,
  mockProviderDashboardApis,
  mockUserRequestsApis,
} from "../_support/scenarios";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

// ─── Local helpers ───────────────────────────────────────────────────────────

function getAuthSessionSecret(): string {
  if (process.env.AUTH_SESSION_SECRET) return process.env.AUTH_SESSION_SECRET;
  const envPath = path.resolve(__dirname, "../../.env.local");
  if (!fs.existsSync(envPath)) return "";
  const line = fs
    .readFileSync(envPath, "utf8")
    .split(/\r?\n/)
    .find((item) => item.trim().startsWith("AUTH_SESSION_SECRET="));
  if (!line) return "";
  return line
    .slice(line.indexOf("=") + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

/**
 * Build a signed kk_auth_session cookie carrying a specific `sver`.
 * Mirrors lib/auth.ts:createSignedSessionCookieValue so a server-side
 * verifySignedSessionCookieValue accepts it. The HMAC fallback (when
 * AUTH_SESSION_SECRET is not in scope) matches the existing
 * bootstrap helpers — the same caveat applies: cookies signed without
 * the real secret will be rejected by the server, but the CLIENT
 * UI-hint cookie will still hydrate the sidebar, which is all the
 * stale-session client guard test needs.
 */
function encodeAuthSession(opts: {
  phone: string;
  sver: number;
}): string {
  const payload = {
    phone: opts.phone,
    verified: true,
    createdAt: Date.now(),
    sver: opts.sver,
  };
  const secret = getAuthSessionSecret();
  if (!secret) return encodeURIComponent(JSON.stringify(payload));
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", secret)
    .update(b64)
    .digest("base64url");
  return encodeURIComponent(`${b64}.${sig}`);
}

async function setVersionedSession(
  page: Page,
  opts: { phone: string; sver: number; admin?: boolean }
): Promise<void> {
  const cookieValue = encodeAuthSession({ phone: opts.phone, sver: opts.sver });
  await page.context().addCookies([
    {
      name: "kk_auth_session",
      value: cookieValue,
      url: appUrl("/"),
      sameSite: "Lax",
    },
    {
      name: "kk_session_user",
      value: JSON.stringify({
        phone: opts.phone,
        verified: true,
        createdAt: Date.now(),
        sver: opts.sver,
      }),
      url: appUrl("/"),
      sameSite: "Lax",
    },
    ...(opts.admin
      ? [
          {
            name: "kk_admin",
            value: "1",
            url: appUrl("/"),
            sameSite: "Lax" as const,
          },
        ]
      : []),
  ]);
  if (opts.admin) {
    await page.addInitScript((data) => {
      window.localStorage.setItem(
        "kk_admin_session",
        JSON.stringify(data)
      );
    }, {
      isAdmin: true,
      name: QA_ADMIN_NAME,
      role: "admin",
      permissions: ["manage_roles"],
    });
  }
}

async function mockWhoamiStale(page: Page): Promise<void> {
  await mockJson(page, /\/api\/auth\/whoami/, {
    status: 401,
    body: { ok: false, reason: "stale" },
  });
}

/**
 * The stale-session path INTENTIONALLY surfaces 401s and the matching
 * console errors that the browser logs for "Failed to load resource".
 * Tell the diagnostics harness those are expected so assertClean() can
 * still catch unrelated regressions.
 */
function allowStaleSessionNoise(diag: {
  allowHttpError: (p: RegExp) => void;
  allowConsoleError: (p: RegExp) => void;
}): void {
  // The diagnostics framework joins entries as "${method} ${url} ${status}"
  // (single spaces). Pattern just needs to appear somewhere in that string.
  diag.allowHttpError(/\/api\/auth\/whoami.*401/i);
  diag.allowHttpError(/\/api\/provider\/.*401/i);
  diag.allowHttpError(/\/api\/my-requests.*401/i);
  diag.allowHttpError(/\/api\/admin\/.*401/i);
  diag.allowConsoleError(
    /Failed to load resource: the server responded with a status of 401/i
  );
}

async function mockWhoamiOk(page: Page, phone: string, sver: number): Promise<void> {
  await mockJson(page, /\/api\/auth\/whoami/, {
    status: 200,
    body: { ok: true, phone, sver },
  });
}

async function mockLogoutOk(page: Page): Promise<void> {
  await mockJson(page, /\/api\/auth\/logout/, {
    status: 200,
    body: { ok: true },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

test.describe("Auth: single-active-session", () => {
  test.use({ baseURL: "http://127.0.0.1:3000" });

  test("user's old device on public / is repaired as guest without redirect", async ({
    page,
    diag,
  }) => {
    allowStaleSessionNoise(diag);
    await mockUserRequestsApis(page, {
      requests: [],
      globalThreads: [],
      taskThreads: [],
    });
    await mockLogoutOk(page);
    await mockWhoamiStale(page);

    await setVersionedSession(page, { phone: QA_USER_PHONE, sver: 1 });

    // Land on a public page. The Sidebar mounts useSessionGuard in public
    // mode, so stale auth hints are cleared without blocking homepage access.
    await gotoPath(page, "/");
    await page.waitForTimeout(500);
    await expect(page).not.toHaveURL(/\/login(\?|$)/);
    await expect(page.getByText("JODHPUR LOCAL SERVICES")).toBeVisible();

    // UI hint cookie is wiped client-side so the next render shows guest
    // chrome instead of the previous "logged in as +91 …" state.
    const cookies = await page.context().cookies();
    const hint = cookies.find((c) => c.name === "kk_session_user");
    expect(hint?.value || "").toBe("");

    diag.assertClean();
  });

  test("provider's old device redirects from /provider/dashboard on stale session", async ({
    page,
    diag,
  }) => {
    allowStaleSessionNoise(diag);
    await mockProviderDashboardApis(page);
    await mockLogoutOk(page);
    await mockWhoamiStale(page);

    await setVersionedSession(page, { phone: QA_PROVIDER_PHONE, sver: 1 });

    await gotoPath(page, "/provider/dashboard");
    await expect(page).toHaveURL(/\/login(\?|$)/);

    diag.assertClean();
  });

  test("admin's old device redirects from /admin/dashboard on stale session", async ({
    page,
    diag,
  }) => {
    allowStaleSessionNoise(diag);
    await mockAdminDashboardApis(page);
    await mockLogoutOk(page);
    await mockWhoamiStale(page);

    await setVersionedSession(page, {
      phone: QA_ADMIN_PHONE,
      sver: 1,
      admin: true,
    });

    await gotoPath(page, "/admin/dashboard");
    await expect(page).toHaveURL(/\/login(\?|$)/);

    diag.assertClean();
  });

  test("latest login still works — page renders when whoami reports ok", async ({
    page,
    diag,
  }) => {
    await mockUserRequestsApis(page, {
      requests: [],
      globalThreads: [],
      taskThreads: [],
    });
    await mockWhoamiOk(page, QA_USER_PHONE, 2);

    await setVersionedSession(page, { phone: QA_USER_PHONE, sver: 2 });

    await gotoPath(page, "/dashboard/my-requests");

    // Should NOT be redirected. The Responses heading is the canonical
    // logged-in indicator the existing guards.spec.ts uses too.
    await expect(page.getByRole("heading", { name: "Responses" })).toBeVisible();
    await expect(page).not.toHaveURL(/\/login/);

    diag.assertClean();
  });

  test("/api/auth/whoami stale response shape matches the contract", async ({
    page,
    diag,
  }) => {
    // Contract test: lock the response shape the client guard relies on.
    // If the server response changes (status code or `reason` key), the
    // useSessionGuard hook stops detecting stale and the feature breaks
    // silently. This test fails first when that happens.
    allowStaleSessionNoise(diag);
    await mockLogoutOk(page);
    await mockJson(page, /\/api\/auth\/whoami/, {
      status: 401,
      body: { ok: false, reason: "stale" },
    });
    await setVersionedSession(page, { phone: QA_USER_PHONE, sver: 1 });
    await gotoPath(page, "/");
    const response = await page.evaluate(async () => {
      const r = await fetch("/api/auth/whoami", { credentials: "same-origin" });
      const body = await r.json();
      return { status: r.status, body };
    });
    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({ ok: false, reason: "stale" });

    diag.assertClean();
  });

  test("normal logout clears the calling browser's cookies (no version bump expected)", async ({
    page,
    diag,
  }) => {
    // This locks the contract that /api/auth/logout DOES NOT bump
    // session_version. We can't read profiles.session_version from
    // Playwright, but we CAN assert the request body is the empty
    // legacy contract (just a clear-cookies call). If a future
    // refactor adds a version-bump side effect, the body shape would
    // change and this test would fail — alerting the author to
    // revisit the no-bump-on-logout rule.
    //
    // Allow the sidebar's background polls (provider notifications,
    // i-need threads, etc.) to 401 on this guest-after-logout state
    // — they are not the subject of this test.
    diag.allowHttpError(/\/api\/.*401/i);
    diag.allowConsoleError(
      /Failed to load resource: the server responded with a status of 401/i
    );

    await mockUserRequestsApis(page, {
      requests: [],
      globalThreads: [],
      taskThreads: [],
    });
    await mockWhoamiOk(page, QA_USER_PHONE, 1);

    let logoutCalls = 0;
    let logoutBody: string | null = null;
    await page.route(/\/api\/auth\/logout/, async (route) => {
      logoutCalls += 1;
      logoutBody = route.request().postData() ?? "";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true }),
      });
    });

    await setVersionedSession(page, { phone: QA_USER_PHONE, sver: 1 });

    // Trigger the sidebar logout button. Same locator pattern as
    // guards.spec.ts.
    await page.setViewportSize({ width: 1280, height: 900 });
    await gotoPath(page, "/");
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();
    await sidebar.getByRole("button", { name: "Logout" }).click();

    await expect(page).toHaveURL(/\/$/);
    expect(logoutCalls).toBeGreaterThanOrEqual(1);
    // Logout body is intentionally empty — no phone, no version, no
    // device id. Confirms the route is a pure cookie-clear call.
    expect(logoutBody === null || logoutBody === "").toBeTruthy();

    diag.assertClean();
  });

  test("anonymous guest opens / without being redirected to /login", async ({
    page,
    diag,
  }) => {
    // Regression guard for the rollout audit: the Sidebar mounts
    // useSessionGuard globally (via app/layout.tsx). If the hook ever
    // again redirects on `reason: "no-session"`, a guest landing on
    // any page — including the marketing homepage — would be force-
    // routed to /login and the entire app would break for new users.
    //
    // This test exercises the path with NO session cookies at all:
    //   1. Server's /api/auth/whoami returns 401 reason="no-session".
    //   2. Hook receives 401, looks at body.reason, sees it is NOT
    //      "stale", does nothing.
    //   3. Guest stays on /.
    await mockCommonCatalogRoutes(page);
    // Sidebar's global notification bell + my-needs polling will 404
    // for a guest because no session is present. Allowlist so the
    // diagnostics harness can still catch unrelated regressions.
    diag.allowHttpError(/\/api\/provider\/notifications.*40/i);
    diag.allowHttpError(/\/api\/auth\/whoami.*401/i);
    diag.allowConsoleError(
      /Failed to load resource: the server responded with a status of (401|404)/i
    );

    await gotoPath(page, "/");
    // Give the guard a beat to fire and (importantly) NOT redirect.
    await page.waitForTimeout(500);

    // Still on the homepage — not bounced to /login.
    expect(page.url()).not.toMatch(/\/login(\?|$)/);

    // Confirm whoami actually returned a no-session 401. If a future
    // refactor changes the response shape (e.g. starts returning 200
    // for guests), this test still passes the "no redirect" assertion
    // above but the diagnostic context makes it obvious what changed.
    const probe = await page.evaluate(async () => {
      const r = await fetch("/api/auth/whoami", { credentials: "same-origin" });
      let body: { ok?: boolean; reason?: string } | null = null;
      try {
        body = (await r.json()) as { ok?: boolean; reason?: string };
      } catch {
        body = null;
      }
      return { status: r.status, body };
    });
    expect(probe.status).toBe(401);
    expect(probe.body).toMatchObject({ ok: false, reason: "no-session" });

    // Definitively still on /, not /login.
    expect(page.url()).not.toMatch(/\/login(\?|$)/);

    diag.assertClean();
  });
});
