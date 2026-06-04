/**
 * OTP guard unit proofs (Launch Fix — Blocker 2).
 *
 * Pure, DB-free, server-free tests of the guard decision core in
 * web/lib/otp/throttle.ts. The core is dependency-injected (callRpc), so we
 * feed canned outcomes and assert behavior without Supabase or a dev server.
 *
 * Proves (per the approved scope):
 *   1. Guard OFF  → no-op (allowed / not-locked, RPC never called).
 *   2. Send guard blocked → allowed:false (route maps this to HTTP 429).
 *   3. Verify guard locked → locked:true (route maps this to HTTP 429).
 *   4. Guard RPC failure → FAIL OPEN (allowed / not-locked).
 *
 * Existing auth regression (otp-paste, single-active-session, etc.) lives in
 * the same e2e/auth folder and runs under the same `test:kk:auth` command.
 */

import { test, expect } from "@playwright/test";

import {
  evaluateSend,
  evaluateVerifyLock,
  isOtpSendGuardEnabled,
  isOtpVerifyGuardEnabled,
} from "@/lib/otp/throttle";

const PHONE = "919999990001";

/** A fake RPC that records calls and returns a canned value (or throws). */
function fakeRpc<T>(result: T | (() => never)) {
  const calls: string[] = [];
  const fn = async (phone: string): Promise<T> => {
    calls.push(phone);
    if (typeof result === "function") (result as () => never)();
    return result as T;
  };
  return { fn, calls };
}

test.describe("OTP guard — decision core (pure, no DB)", () => {
  // ── Proof 1: guard OFF = unchanged behavior (no-op, RPC not called) ───────
  test("1a. send guard OFF → allowed + skipped, RPC never called", async () => {
    const rpc = fakeRpc({ allowed: false, retry_after_seconds: 999, reason: "should_not_run" });
    const d = await evaluateSend({ enabled: false, phone: PHONE, callRpc: rpc.fn });
    expect(d.allowed).toBe(true);
    expect(d.skipped).toBe(true);
    expect(rpc.calls).toHaveLength(0);
  });

  test("1b. verify guard OFF → not locked + skipped, RPC never called", async () => {
    const rpc = fakeRpc({ locked: true, retry_after_seconds: 900 });
    const d = await evaluateVerifyLock({ enabled: false, phone: PHONE, callRpc: rpc.fn });
    expect(d.locked).toBe(false);
    expect(d.skipped).toBe(true);
    expect(rpc.calls).toHaveLength(0);
  });

  // ── Proof 2: send guard blocked → allowed:false (→ HTTP 429) ──────────────
  test("2. send guard ON + RPC denies → allowed:false with retryAfter", async () => {
    const rpc = fakeRpc({ allowed: false, retry_after_seconds: 30, reason: "hourly_cap" });
    const d = await evaluateSend({ enabled: true, phone: PHONE, callRpc: rpc.fn });
    expect(d.allowed).toBe(false);
    expect(d.retryAfterSeconds).toBe(30);
    expect(d.reason).toBe("hourly_cap");
    expect(rpc.calls).toEqual([PHONE]);
  });

  test("2b. send guard ON + RPC allows → allowed:true (normal send)", async () => {
    const rpc = fakeRpc({ allowed: true, retry_after_seconds: 0, reason: "allowed" });
    const d = await evaluateSend({ enabled: true, phone: PHONE, callRpc: rpc.fn });
    expect(d.allowed).toBe(true);
    expect(d.failOpen).toBeFalsy();
  });

  // ── Proof 3: verify guard locked → locked:true (→ HTTP 429) ───────────────
  test("3. verify guard ON + RPC locked → locked:true with retryAfter", async () => {
    const rpc = fakeRpc({ locked: true, retry_after_seconds: 900 });
    const d = await evaluateVerifyLock({ enabled: true, phone: PHONE, callRpc: rpc.fn });
    expect(d.locked).toBe(true);
    expect(d.retryAfterSeconds).toBe(900);
  });

  test("3b. verify guard ON + RPC not locked → locked:false (normal verify)", async () => {
    const rpc = fakeRpc({ locked: false, retry_after_seconds: 0 });
    const d = await evaluateVerifyLock({ enabled: true, phone: PHONE, callRpc: rpc.fn });
    expect(d.locked).toBe(false);
    expect(d.failOpen).toBeFalsy();
  });

  // ── Proof 4: RPC failure → FAIL OPEN ──────────────────────────────────────
  test("4a. send guard ON + RPC throws → fail open (allowed:true)", async () => {
    const thrower = async (): Promise<never> => {
      throw new Error("supabase down");
    };
    const d = await evaluateSend({ enabled: true, phone: PHONE, callRpc: thrower });
    expect(d.allowed).toBe(true);
    expect(d.failOpen).toBe(true);
  });

  test("4b. verify guard ON + RPC throws → fail open (locked:false)", async () => {
    const thrower = async (): Promise<never> => {
      throw new Error("supabase down");
    };
    const d = await evaluateVerifyLock({ enabled: true, phone: PHONE, callRpc: thrower });
    expect(d.locked).toBe(false);
    expect(d.failOpen).toBe(true);
  });

  // ── Bonus: flag parsing (default OFF; accepts "true"/"1") ──────────────────
  test("5. flag readers default OFF and accept true/1", async () => {
    const save = {
      send: process.env.KK_OTP_SEND_GUARD_ENABLED,
      verify: process.env.KK_OTP_VERIFY_GUARD_ENABLED,
    };
    try {
      delete process.env.KK_OTP_SEND_GUARD_ENABLED;
      delete process.env.KK_OTP_VERIFY_GUARD_ENABLED;
      expect(isOtpSendGuardEnabled()).toBe(false);
      expect(isOtpVerifyGuardEnabled()).toBe(false);

      process.env.KK_OTP_SEND_GUARD_ENABLED = "true";
      process.env.KK_OTP_VERIFY_GUARD_ENABLED = "1";
      expect(isOtpSendGuardEnabled()).toBe(true);
      expect(isOtpVerifyGuardEnabled()).toBe(true);

      process.env.KK_OTP_SEND_GUARD_ENABLED = "false";
      process.env.KK_OTP_VERIFY_GUARD_ENABLED = "0";
      expect(isOtpSendGuardEnabled()).toBe(false);
      expect(isOtpVerifyGuardEnabled()).toBe(false);
    } finally {
      if (save.send === undefined) delete process.env.KK_OTP_SEND_GUARD_ENABLED;
      else process.env.KK_OTP_SEND_GUARD_ENABLED = save.send;
      if (save.verify === undefined) delete process.env.KK_OTP_VERIFY_GUARD_ENABLED;
      else process.env.KK_OTP_VERIFY_GUARD_ENABLED = save.verify;
    }
  });
});
