/**
 * Phase B Step 5 — admin push registration core (pure unit spec).
 *
 * No dev server / DOM / Firebase. Verifies the registration orchestration
 * and the platform:"web" body contract. The live button flow (which needs
 * the build flag + real Firebase + HTTPS + an installed PWA) is verified
 * manually — see the report.
 */

import { test, expect } from "@playwright/test";

import {
  adminWebDeviceBody,
  describeTestPushResult,
  registerAdminPush,
  type AdminPushDeps,
} from "../../lib/push/adminPushCore";
import { normalizeDevicePlatform } from "../../lib/push/devicePlatform";

test.describe("Phase B — normalizeDevicePlatform", () => {
  test("'web' stays web; everything else defaults to android", () => {
    expect(normalizeDevicePlatform("web")).toBe("web");
    expect(normalizeDevicePlatform("android")).toBe("android");
    expect(normalizeDevicePlatform(undefined)).toBe("android");
    expect(normalizeDevicePlatform("ios")).toBe("android");
    expect(normalizeDevicePlatform("")).toBe("android");
  });
});

test.describe("Phase B — adminWebDeviceBody", () => {
  test("posts platform:'web' and the token, never actor_type", () => {
    const body = adminWebDeviceBody("tok_123");
    expect(body).toEqual({ fcmToken: "tok_123", platform: "web" });
    expect("actor_type" in body).toBe(false);
  });
});

// Deps that record calls; each test overrides as needed.
function makeDeps(over: Partial<AdminPushDeps> = {}): {
  deps: AdminPushDeps;
  calls: { permission: number; token: number; post: number; postedToken: string | null };
} {
  const calls = { permission: 0, token: 0, post: 0, postedToken: null as string | null };
  const deps: AdminPushDeps = {
    isSupported: () => true,
    isConfigured: () => true,
    requestPermission: async () => {
      calls.permission += 1;
      return "granted";
    },
    getToken: async () => {
      calls.token += 1;
      return "tok_abc";
    },
    postDevice: async (token) => {
      calls.post += 1;
      calls.postedToken = token;
      return { ok: true };
    },
    ...over,
  };
  return { deps, calls };
}

test.describe("Phase B — describeTestPushResult", () => {
  test("sent > 0 → success", () => {
    const m = describeTestPushResult(true, { ok: true, sent: 1, message: "Test push sent." });
    expect(m.kind).toBe("success");
    expect(m.text).toContain("sent");
  });

  test("ok but 0 sent → info (no delivery)", () => {
    const m = describeTestPushResult(true, { ok: true, sent: 0, message: "No push device registered. Click Enable Push Alerts first." });
    expect(m.kind).toBe("info");
    expect(m.text).toContain("Enable Push Alerts");
  });

  test("http error / not ok → error", () => {
    expect(describeTestPushResult(false, null).kind).toBe("error");
    expect(
      describeTestPushResult(false, { ok: false, error: "FORBIDDEN", message: "Admin only." }).text
    ).toContain("Admin only.");
  });
});

test.describe("Phase B — registerAdminPush", () => {
  test("success → registered; POST receives the token (after permission+token)", async () => {
    const { deps, calls } = makeDeps();
    const r = await registerAdminPush(deps);
    expect(r).toEqual({ status: "registered" });
    expect(calls.permission).toBe(1);
    expect(calls.token).toBe(1);
    expect(calls.post).toBe(1);
    expect(calls.postedToken).toBe("tok_abc");
  });

  test("unsupported → no permission prompt, no POST", async () => {
    const { deps, calls } = makeDeps({ isSupported: () => false });
    const r = await registerAdminPush(deps);
    expect(r).toEqual({ status: "unsupported" });
    expect(calls.permission).toBe(0);
    expect(calls.post).toBe(0);
  });

  test("unconfigured → no permission prompt, no POST", async () => {
    const { deps, calls } = makeDeps({ isConfigured: () => false });
    const r = await registerAdminPush(deps);
    expect(r).toEqual({ status: "unconfigured" });
    expect(calls.permission).toBe(0);
    expect(calls.post).toBe(0);
  });

  test("permission denied → no token, no POST", async () => {
    const { deps, calls } = makeDeps({ requestPermission: async () => "denied" });
    const r = await registerAdminPush(deps);
    expect(r).toEqual({ status: "denied" });
    expect(calls.token).toBe(0);
    expect(calls.post).toBe(0);
  });

  test("no token → error, no POST", async () => {
    const { deps, calls } = makeDeps({ getToken: async () => null });
    const r = await registerAdminPush(deps);
    expect(r.status).toBe("error");
    expect(calls.post).toBe(0);
  });

  test("POST failure → error (surfaces server message)", async () => {
    const { deps } = makeDeps({
      postDevice: async () => ({ ok: false, error: "Failed to register device" }),
    });
    const r = await registerAdminPush(deps);
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.error).toContain("Failed to register device");
  });

  test("a throwing dep is caught → error, never propagates", async () => {
    const { deps } = makeDeps({
      requestPermission: async () => {
        throw new Error("boom");
      },
    });
    const r = await registerAdminPush(deps);
    expect(r.status).toBe("error");
    if (r.status === "error") expect(r.error).toContain("boom");
  });
});
