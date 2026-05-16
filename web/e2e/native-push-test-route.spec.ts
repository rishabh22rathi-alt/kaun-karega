import { expect, test } from "@playwright/test";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(__dirname, "../.env.local") });
loadEnv({ path: path.resolve(__dirname, "../.env") });

const SECRET = (process.env.NATIVE_PUSH_TEST_SECRET || "").trim();
const FIREBASE_CONFIGURED =
  (process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "").trim().length > 0;

// Auth-gate-only coverage. We deliberately do NOT exercise a real FCM call
// here — that requires a valid service account and a real registered
// handset, which only happens during the §9 manual test matrix.

test.describe("native push manual test route — auth gates", () => {
  test("rejects anonymous POST with no headers", async ({ request }) => {
    const res = await request.post("/api/native-push/test", {
      data: { targetPhone: "9999999999" },
    });
    // 503 when route env is missing, 403 when env is set but no header.
    // Both are safe denials — assert the route is NEVER accepted anonymously.
    expect([403, 503]).toContain(res.status());
  });

  test("returns 503 when NATIVE_PUSH_TEST_SECRET is missing", async ({
    request,
  }) => {
    test.skip(
      SECRET.length >= 16,
      "Route secret is configured in this env; this test only applies when it is not."
    );
    const res = await request.post("/api/native-push/test", {
      headers: { "x-kk-test-secret": "whatever-the-caller-supplies-here" },
      data: { targetPhone: "9999999999" },
    });
    expect(res.status()).toBe(503);
    const body = (await res.json()) as { ok: unknown };
    expect(body.ok).toBe(false);
  });

  test("returns 503 when Firebase Admin env is missing", async ({
    request,
  }) => {
    test.skip(
      SECRET.length < 16,
      "Cannot reach the Firebase env gate without a valid route secret."
    );
    test.skip(
      FIREBASE_CONFIGURED,
      "Firebase Admin is configured; this test only applies when it is not."
    );
    const res = await request.post("/api/native-push/test", {
      headers: { "x-kk-test-secret": SECRET },
      data: { targetPhone: "9999999999" },
    });
    expect(res.status()).toBe(503);
  });

  test("returns 403 when route secret is wrong", async ({ request }) => {
    test.skip(
      SECRET.length < 16,
      "Route secret is not configured; route 503s before reaching the header check."
    );
    test.skip(
      !FIREBASE_CONFIGURED,
      "Firebase Admin is not configured; route 503s before reaching the header check."
    );
    const res = await request.post("/api/native-push/test", {
      headers: { "x-kk-test-secret": "definitely-not-the-real-secret-1234" },
      data: { targetPhone: "9999999999" },
    });
    expect(res.status()).toBe(403);
  });

  test("returns 401 when no session cookie is present", async ({ request }) => {
    test.skip(
      SECRET.length < 16 || !FIREBASE_CONFIGURED,
      "Cannot reach the session gate without both env vars set."
    );
    const res = await request.post("/api/native-push/test", {
      headers: { "x-kk-test-secret": SECRET },
      data: { targetPhone: "9999999999" },
    });
    expect(res.status()).toBe(401);
  });
});
