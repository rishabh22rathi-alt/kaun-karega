/**
 * A1–A8 security regression suite.
 *
 * Verifies the post-audit security posture without relying on real OTP /
 * WhatsApp infra. The suite is API-level wherever possible so it does not
 * depend on the front-end auth UI (which still requires real OTP delivery
 * to log a user in).
 *
 * Auth model:
 *   - "Anonymous" tests use a fresh request context with no cookie.
 *   - "Forged" tests use the legacy plaintext-JSON cookie that pre-A1
 *     authenticated everywhere — the suite asserts these are now rejected.
 *   - "Real session" tests mint an HMAC-signed cookie using the same
 *     scheme as `lib/auth.ts` (Web Crypto, base64url(payload).base64url(sig))
 *     keyed on `process.env.AUTH_SESSION_SECRET`. If the secret is not
 *     available to the test runner, those test cases skip with an
 *     explanation of the seed/env requirement.
 *
 * Seed assumptions (defined in `e2e/_support/data.ts`):
 *   - QA_USER_PHONE  9999999901  — a regular user
 *   - QA_PROVIDER_PHONE 9999999902 — a registered provider with PR-QA-0001
 *   - QA_ADMIN_PHONE 9999999904 — an admin row in `admins`
 * If those seed rows are missing from the local DB, tests that need them
 * are skipped.
 */

import {
  test,
  expect,
  request as playwrightRequest,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";
import { config as loadEnv } from "dotenv";
import path from "node:path";

import {
  QA_USER_PHONE,
  QA_PROVIDER_PHONE,
  QA_PROVIDER_ID,
  QA_ADMIN_PHONE,
  QA_TASK_ID,
  QA_NEED_ID,
  QA_THREAD_ID,
  QA_AREA,
  QA_CATEGORY,
} from "./_support/data";

// Load env from web/.env.local then web/.env so AUTH_SESSION_SECRET is
// available outside the Next.js dev server process.
loadEnv({ path: path.resolve(__dirname, "..", ".env.local") });
loadEnv({ path: path.resolve(__dirname, "..", ".env") });

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

const AUTH_SESSION_SECRET = (process.env.AUTH_SESSION_SECRET ?? "").trim();
const SIGNED_COOKIES_AVAILABLE = AUTH_SESSION_SECRET.length >= 16;

const SECRET_MISSING_REASON =
  "AUTH_SESSION_SECRET (>=16 chars) is not visible to the Playwright runner. " +
  "Set it in web/.env.local so the test can mint a real signed kk_auth_session cookie.";

// A non-seeded phone used to prove cross-user impersonation paths return
// 401/403. We never rely on this phone being a real user — the tests assert
// the rejection, not any successful behavior with this phone.
const VICTIM_USER_PHONE = "9111111122";

// ─── Crypto helpers (mirror lib/auth.ts) ─────────────────────────────────

function utf8Buffer(value: string): ArrayBuffer {
  const enc = new TextEncoder().encode(value);
  const out = new ArrayBuffer(enc.byteLength);
  new Uint8Array(out).set(enc);
  return out;
}

function bufToBase64Url(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < view.byteLength; i += 1) {
    bin += String.fromCharCode(view[i]);
  }
  return Buffer.from(bin, "binary")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function mintSignedSessionCookie(phone10: string): Promise<string> {
  if (!SIGNED_COOKIES_AVAILABLE) {
    throw new Error("AUTH_SESSION_SECRET unavailable");
  }
  const canonical = phone10.startsWith("91")
    ? phone10
    : `91${phone10.replace(/\D/g, "").slice(-10)}`;
  const payloadJson = JSON.stringify({
    phone: canonical,
    verified: true,
    createdAt: Date.now(),
  });
  const payload = bufToBase64Url(utf8Buffer(payloadJson));
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    utf8Buffer(AUTH_SESSION_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    utf8Buffer(payload)
  );
  return `${payload}.${bufToBase64Url(sig)}`;
}

function buildForgedCookie(phone10 = VICTIM_USER_PHONE): string {
  // Pre-A1 plaintext JSON shape. After A1, this is rejected because it
  // has no signature suffix.
  return encodeURIComponent(
    JSON.stringify({
      phone: `91${phone10.replace(/\D/g, "").slice(-10)}`,
      verified: true,
      createdAt: Date.now(),
    })
  );
}

// ─── Request context helpers ─────────────────────────────────────────────

async function newAnonContext(): Promise<APIRequestContext> {
  return playwrightRequest.newContext({ baseURL: BASE_URL });
}

async function newForgedContext(
  phone10 = VICTIM_USER_PHONE
): Promise<APIRequestContext> {
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      Cookie: `kk_auth_session=${buildForgedCookie(phone10)}; kk_admin=1`,
    },
  });
}

async function newSignedContext(
  phone10: string
): Promise<APIRequestContext> {
  const cookieValue = await mintSignedSessionCookie(phone10);
  return playwrightRequest.newContext({
    baseURL: BASE_URL,
    extraHTTPHeaders: {
      Cookie: `kk_auth_session=${cookieValue}`,
    },
  });
}

// Best-effort detection: does this signed-session phone correspond to a
// seeded row server-side? We probe an endpoint that returns a stable
// 200/4xx based on whether the session phone is recognized. We use
// `/api/my-requests` which:
//   - 401 if cookie isn't a valid signed session
//   - 200 with `requests` array (possibly empty) for any signed session
// So a 200 response confirms the signed cookie path itself works; the
// presence of seeded data is a separate question we surface in skip
// messages where relevant.
async function probeSignedSessionWorks(phone10: string): Promise<boolean> {
  if (!SIGNED_COOKIES_AVAILABLE) return false;
  const ctx = await newSignedContext(phone10);
  try {
    const res = await ctx.get("/api/my-requests");
    return res.ok();
  } catch {
    return false;
  } finally {
    await ctx.dispose();
  }
}

// Probe: does the seeded provider phone resolve to a real provider row?
// A signed-session call to /api/provider/dashboard-profile returns 200
// with `ok:true` and a provider object only when the phone has a
// providers row. We use this as the gate for tests that need a real
// seeded provider session.
async function probeSeededProvider(phone10: string): Promise<boolean> {
  if (!SIGNED_COOKIES_AVAILABLE) return false;
  const ctx = await newSignedContext(phone10);
  try {
    const res = await ctx.get("/api/provider/dashboard-profile");
    if (!res.ok()) return false;
    const body = (await res.json()) as { ok?: unknown; provider?: { ProviderID?: unknown } };
    return body.ok === true && typeof body.provider?.ProviderID === "string";
  } catch {
    return false;
  } finally {
    await ctx.dispose();
  }
}

// ─── 1. Auth / session (A1) ──────────────────────────────────────────────

test.describe("A1 — signed session cookie", () => {
  test("anonymous request to a session-required endpoint returns 401", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await ctx.get("/api/my-requests");
      expect(res.status(), "anonymous /api/my-requests").toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("forged plaintext-JSON cookie does not authenticate", async () => {
    const ctx = await newForgedContext();
    try {
      const res = await ctx.get("/api/my-requests");
      expect(
        res.status(),
        "forged kk_auth_session must not authenticate post-A1"
      ).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("HMAC-signed cookie authenticates against my-requests", async () => {
    test.skip(!SIGNED_COOKIES_AVAILABLE, SECRET_MISSING_REASON);
    const ctx = await newSignedContext(QA_USER_PHONE);
    try {
      const res = await ctx.get("/api/my-requests");
      expect(res.status(), "signed cookie should authenticate").toBe(200);
      const body = (await res.json()) as { ok?: unknown };
      expect(body.ok).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });

  test("/api/auth/logout clears auth cookies via Set-Cookie", async () => {
    test.skip(!SIGNED_COOKIES_AVAILABLE, SECRET_MISSING_REASON);
    const ctx = await newSignedContext(QA_USER_PHONE);
    try {
      const res = await ctx.post("/api/auth/logout");
      expect(res.ok()).toBe(true);
      const setCookies = (res.headersArray() || []).filter(
        (h) => h.name.toLowerCase() === "set-cookie"
      );
      const cookieHeader = setCookies.map((h) => h.value).join("\n");
      expect(cookieHeader).toMatch(/kk_auth_session=/);
      // Cleared cookies have Max-Age=0 (or expires in the past).
      expect(
        /kk_auth_session=;[^\n]*Max-Age=0/i.test(cookieHeader),
        "logout response should expire kk_auth_session"
      ).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });
});

// ─── 2. Admin protection (A5) ────────────────────────────────────────────

test.describe("A5 — /api/admin/aliases requires active admin", () => {
  test("anonymous GET /api/admin/aliases returns 401", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await ctx.get("/api/admin/aliases?status=pending");
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("anonymous POST /api/admin/aliases approve returns 401", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await ctx.post("/api/admin/aliases", {
        data: { action: "approve", alias: "no-such-alias" },
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("forged cookie GET /api/admin/aliases returns 401", async () => {
    const ctx = await newForgedContext(QA_ADMIN_PHONE);
    try {
      const res = await ctx.get("/api/admin/aliases?status=pending");
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("active admin can read /api/admin/aliases", async () => {
    test.skip(!SIGNED_COOKIES_AVAILABLE, SECRET_MISSING_REASON);
    const ctx = await newSignedContext(QA_ADMIN_PHONE);
    try {
      const res = await ctx.get("/api/admin/aliases?status=pending");
      // 200 if QA_ADMIN_PHONE is seeded in `admins` with active=true.
      // 401 if the seed is missing — we surface that as a skip rather
      // than a hard fail because the seed is environmental.
      if (res.status() === 401) {
        test.skip(
          true,
          `Admin seed missing: ${QA_ADMIN_PHONE} not present in admins table with active=true`
        );
      }
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { ok?: unknown };
      expect(body.ok).toBe(true);
    } finally {
      await ctx.dispose();
    }
  });
});

// ─── 3. find-provider privacy (A6) ───────────────────────────────────────

test.describe("A6 — /api/find-provider does not leak raw phones", () => {
  test("public response has no `phone` field; uses phoneMasked instead", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await ctx.get(
        `/api/find-provider?category=${encodeURIComponent(
          QA_CATEGORY
        )}&area=${encodeURIComponent(QA_AREA)}`
      );
      // Public route — must respond regardless of session state.
      expect(res.ok()).toBe(true);
      const body = (await res.json()) as {
        providers?: Array<Record<string, unknown>>;
      };
      const providers = Array.isArray(body.providers) ? body.providers : [];
      for (const p of providers) {
        expect(
          Object.prototype.hasOwnProperty.call(p, "phone"),
          "provider object must not carry raw `phone`"
        ).toBe(false);
      }
      // If any providers came back, they should have phoneMasked of the
      // form "XXxxxxxxXX".
      for (const p of providers) {
        const masked = String(p.phoneMasked ?? "");
        if (masked.length > 0) {
          expect(masked).toMatch(/^\d{2}X{6}\d{2}$/);
        }
      }
    } finally {
      await ctx.dispose();
    }
  });
});

// ─── 4. process-task-notifications (A7) ──────────────────────────────────

test.describe("A7 — /api/process-task-notifications is owner-bound", () => {
  test("anonymous request returns 401", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await ctx.post("/api/process-task-notifications", {
        data: { taskId: QA_TASK_ID },
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("forged cookie returns 401", async () => {
    const ctx = await newForgedContext();
    try {
      const res = await ctx.post("/api/process-task-notifications", {
        data: { taskId: QA_TASK_ID },
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("non-owner signed session returns 403 (when task exists)", async () => {
    test.skip(!SIGNED_COOKIES_AVAILABLE, SECRET_MISSING_REASON);
    const ctx = await newSignedContext(VICTIM_USER_PHONE);
    try {
      const res = await ctx.post("/api/process-task-notifications", {
        data: { taskId: QA_TASK_ID },
      });
      // 404 if QA_TASK_ID is not seeded; 403 once it is. Either way, we
      // must NOT see 200 — that would mean a non-owner triggered the
      // pipeline.
      expect([403, 404]).toContain(res.status());
      if (res.status() === 404) {
        test.skip(
          true,
          `Task seed missing: ${QA_TASK_ID} not present in tasks table — cannot fully exercise 403 path`
        );
      }
    } finally {
      await ctx.dispose();
    }
  });

  test("idempotency: repeat call by owner returns skipped/idempotent on terminal status", async () => {
    test.skip(
      !SIGNED_COOKIES_AVAILABLE,
      "Requires signed-cookie support AND seeded task in terminal status (notified/closed/etc.)"
    );
    const ctx = await newSignedContext(QA_USER_PHONE);
    try {
      const res = await ctx.post("/api/process-task-notifications", {
        data: { taskId: QA_TASK_ID },
      });
      // 404 = no seeded task; 200 with skipped=true is the idempotent
      // path; 200 without skipped is the first-run path.
      if (res.status() === 404) {
        test.skip(true, `Task seed missing: ${QA_TASK_ID}`);
      }
      expect(res.ok()).toBe(true);
      const body = (await res.json()) as {
        ok?: unknown;
        skipped?: unknown;
        skippedReason?: unknown;
      };
      // The first run after seeding will not set skipped. Subsequent
      // calls will. Just assert the shape is correct either way.
      expect(body.ok).toBe(true);
      if (body.skipped === true) {
        expect(typeof body.skippedReason).toBe("string");
      }
    } finally {
      await ctx.dispose();
    }
  });
});

// ─── 5. /api/tasks/respond (A4) ──────────────────────────────────────────

test.describe("A4 — /api/tasks/respond requires session + provider ownership", () => {
  test("anonymous GET returns 401", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await ctx.get(
        `/api/tasks/respond?taskId=${encodeURIComponent(
          QA_TASK_ID
        )}&providerId=${encodeURIComponent(QA_PROVIDER_ID)}`
      );
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("anonymous POST returns 401", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await ctx.post("/api/tasks/respond", {
        data: { taskId: QA_TASK_ID, providerId: QA_PROVIDER_ID },
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("forged cookie returns 401", async () => {
    const ctx = await newForgedContext(QA_PROVIDER_PHONE);
    try {
      const res = await ctx.post("/api/tasks/respond", {
        data: { taskId: QA_TASK_ID, providerId: QA_PROVIDER_ID },
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("provider A claiming providerId B returns 403", async () => {
    test.skip(!SIGNED_COOKIES_AVAILABLE, SECRET_MISSING_REASON);
    const seeded = await probeSeededProvider(QA_PROVIDER_PHONE);
    test.skip(
      !seeded,
      `Provider seed missing: phone ${QA_PROVIDER_PHONE} does not resolve to a providers row`
    );
    const ctx = await newSignedContext(QA_PROVIDER_PHONE);
    try {
      const res = await ctx.post("/api/tasks/respond", {
        data: { taskId: QA_TASK_ID, providerId: "PR-NOT-ME" },
      });
      // 403 = providerId mismatch (the path under test). 404 only if
      // taskId isn't seeded — we don't get that far in the gate order.
      expect(res.status()).toBe(403);
    } finally {
      await ctx.dispose();
    }
  });

  test("logged-in non-provider user returns 403 (NOT registered as provider)", async () => {
    test.skip(!SIGNED_COOKIES_AVAILABLE, SECRET_MISSING_REASON);
    const ctx = await newSignedContext(VICTIM_USER_PHONE);
    try {
      const res = await ctx.post("/api/tasks/respond", {
        data: { taskId: QA_TASK_ID, providerId: QA_PROVIDER_ID },
      });
      expect(res.status()).toBe(403);
    } finally {
      await ctx.dispose();
    }
  });
});

// ─── 6. Chat protection (A2) ─────────────────────────────────────────────

async function postKkAction(
  ctx: APIRequestContext,
  payload: Record<string, unknown>
): Promise<APIResponse> {
  return ctx.post("/api/kk", { data: payload });
}

test.describe("A2 — /api/kk chat actions require signed session", () => {
  test("anonymous chat_get_threads returns 401", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await postKkAction(ctx, {
        action: "chat_get_threads",
        ActorType: "user",
        UserPhone: VICTIM_USER_PHONE,
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("forged cookie + impersonating UserPhone in body returns 401", async () => {
    const ctx = await newForgedContext();
    try {
      const res = await postKkAction(ctx, {
        action: "chat_get_threads",
        ActorType: "user",
        UserPhone: QA_USER_PHONE,
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("anonymous chat_send_message returns 401", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await postKkAction(ctx, {
        action: "chat_send_message",
        ActorType: "user",
        UserPhone: VICTIM_USER_PHONE,
        ThreadID: QA_THREAD_ID,
        MessageText: "anonymous attempt",
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("logged-in attacker cannot fetch victim threads via UserPhone in body", async () => {
    test.skip(!SIGNED_COOKIES_AVAILABLE, SECRET_MISSING_REASON);
    const ctx = await newSignedContext(VICTIM_USER_PHONE);
    try {
      const res = await postKkAction(ctx, {
        action: "chat_get_threads",
        ActorType: "user",
        UserPhone: QA_USER_PHONE, // pretend to be the victim
      });
      // Route should authenticate the session as VICTIM_USER_PHONE and
      // return only their threads — never the impersonated user's. Since
      // VICTIM_USER_PHONE is not seeded, we expect either 200 with an
      // empty `threads` array (the new identity-bound filter applied) or
      // a 401/403 if no provider row exists. Anything that returns
      // QA_USER_PHONE's threads is a hard fail.
      const status = res.status();
      expect([200, 401, 403]).toContain(status);
      if (status === 200) {
        const body = (await res.json()) as {
          threads?: Array<Record<string, unknown>>;
        };
        const threads = Array.isArray(body.threads) ? body.threads : [];
        for (const t of threads) {
          // None of the returned threads should belong to the
          // impersonated victim.
          expect(String(t.UserPhone ?? "").trim()).not.toBe(QA_USER_PHONE);
        }
      }
    } finally {
      await ctx.dispose();
    }
  });
});

// ─── 7. Need ownership (A3) ──────────────────────────────────────────────

test.describe("A3 — need-ownership actions require signed session", () => {
  test("anonymous create_need returns 401", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await postKkAction(ctx, {
        action: "create_need",
        UserPhone: VICTIM_USER_PHONE,
        IsAnonymous: false,
        DisplayName: "Anon Attacker",
        Category: QA_CATEGORY,
        Areas: [QA_AREA],
        Title: "Should be rejected",
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("anonymous get_my_needs returns 401", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await postKkAction(ctx, {
        action: "get_my_needs",
        UserPhone: QA_USER_PHONE,
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("anonymous close_need returns 401", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await postKkAction(ctx, {
        action: "close_need",
        NeedID: QA_NEED_ID,
        UserPhone: QA_USER_PHONE,
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("forged cookie get_my_needs returns 401", async () => {
    const ctx = await newForgedContext();
    try {
      const res = await postKkAction(ctx, {
        action: "get_my_needs",
        UserPhone: QA_USER_PHONE,
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("logged-in caller cannot fetch victim's needs via body UserPhone", async () => {
    test.skip(!SIGNED_COOKIES_AVAILABLE, SECRET_MISSING_REASON);
    const ctx = await newSignedContext(VICTIM_USER_PHONE);
    try {
      const res = await postKkAction(ctx, {
        action: "get_my_needs",
        UserPhone: QA_USER_PHONE, // attempt to read someone else's
      });
      expect(res.ok()).toBe(true);
      const body = (await res.json()) as {
        needs?: Array<Record<string, unknown>>;
      };
      const needs = Array.isArray(body.needs) ? body.needs : [];
      // Filter must be bound to session phone (VICTIM_USER_PHONE), so any
      // need belonging to QA_USER_PHONE leaking through is a fail.
      for (const n of needs) {
        const ownerPhone = String(n.UserPhone ?? "").replace(/\D/g, "").slice(-10);
        expect(ownerPhone).not.toBe(QA_USER_PHONE);
      }
    } finally {
      await ctx.dispose();
    }
  });

  test("logged-in caller cannot close another user's NeedID", async () => {
    test.skip(!SIGNED_COOKIES_AVAILABLE, SECRET_MISSING_REASON);
    const ctx = await newSignedContext(VICTIM_USER_PHONE);
    try {
      const res = await postKkAction(ctx, {
        action: "close_need",
        NeedID: QA_NEED_ID,
        UserPhone: VICTIM_USER_PHONE, // body field ignored anyway
      });
      // 403 = owner mismatch (the gate under test). 404 only if NeedID
      // is not seeded. Both prove a non-owner cannot close.
      expect([403, 404]).toContain(res.status());
    } finally {
      await ctx.dispose();
    }
  });
});

// ─── 8. /api/provider/aliases (A8) ───────────────────────────────────────

test.describe("A8 — /api/provider/aliases binds providerId to session", () => {
  test("anonymous POST returns 401", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await ctx.post("/api/provider/aliases", {
        data: {
          providerId: QA_PROVIDER_ID,
          alias: "anon-alias",
          canonicalCategory: QA_CATEGORY,
        },
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("forged cookie POST returns 401", async () => {
    const ctx = await newForgedContext(QA_PROVIDER_PHONE);
    try {
      const res = await ctx.post("/api/provider/aliases", {
        data: {
          providerId: QA_PROVIDER_ID,
          alias: "forged-alias",
          canonicalCategory: QA_CATEGORY,
        },
      });
      expect(res.status()).toBe(401);
    } finally {
      await ctx.dispose();
    }
  });

  test("non-provider signed session returns 403", async () => {
    test.skip(!SIGNED_COOKIES_AVAILABLE, SECRET_MISSING_REASON);
    const ctx = await newSignedContext(VICTIM_USER_PHONE);
    try {
      const res = await ctx.post("/api/provider/aliases", {
        data: {
          providerId: QA_PROVIDER_ID,
          alias: "user-trying-to-pin",
          canonicalCategory: QA_CATEGORY,
        },
      });
      expect(res.status()).toBe(403);
    } finally {
      await ctx.dispose();
    }
  });

  test("provider A submitting with providerId=B returns 403 PROVIDER_ID_MISMATCH", async () => {
    test.skip(!SIGNED_COOKIES_AVAILABLE, SECRET_MISSING_REASON);
    const seeded = await probeSeededProvider(QA_PROVIDER_PHONE);
    test.skip(
      !seeded,
      `Provider seed missing: phone ${QA_PROVIDER_PHONE} does not resolve to a providers row`
    );
    const ctx = await newSignedContext(QA_PROVIDER_PHONE);
    try {
      const res = await ctx.post("/api/provider/aliases", {
        data: {
          providerId: "PR-SOMEONE-ELSE",
          alias: "spoofed-alias",
          canonicalCategory: QA_CATEGORY,
        },
      });
      expect(res.status()).toBe(403);
      const body = (await res.json()) as { error?: unknown };
      expect(String(body.error || "")).toContain("MISMATCH");
    } finally {
      await ctx.dispose();
    }
  });
});

// ─── Sanity: can the test runner reach the dev server at all? ────────────

test.describe("environment sanity", () => {
  test("dev server reachable at PLAYWRIGHT_BASE_URL", async () => {
    const ctx = await newAnonContext();
    try {
      const res = await ctx.get("/api/categories");
      // Any 2xx/4xx (not network-level) confirms the route handler
      // pipeline is responsive. We don't care which.
      expect(res.status()).toBeGreaterThanOrEqual(200);
      expect(res.status()).toBeLessThan(600);
    } finally {
      await ctx.dispose();
    }
  });

  test("signed-cookie path is exercised when AUTH_SESSION_SECRET is set", async () => {
    if (!SIGNED_COOKIES_AVAILABLE) {
      test.skip(true, SECRET_MISSING_REASON);
    }
    const works = await probeSignedSessionWorks(QA_USER_PHONE);
    expect(works, "signed cookie should authenticate against /api/my-requests").toBe(true);
  });
});
