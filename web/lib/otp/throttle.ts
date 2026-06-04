/**
 * OTP send/verify guard (Launch Fix — Blocker 2).
 *
 * Adds rate-limiting (send) and lockout (verify) to the two CANONICAL OTP
 * routes only:
 *   /api/send-whatsapp-otp  → guardSend()
 *   /api/verify-otp         → guardVerifyLock() + noteVerifyFailure() + clearVerify()
 *
 * Safety model:
 *   - Two independent kill switches, read per-call (no redeploy to flip):
 *       KK_OTP_SEND_GUARD_ENABLED, KK_OTP_VERIFY_GUARD_ENABLED — both default OFF.
 *   - Guard OFF  → complete no-op; the RPC is never called and behavior is
 *     byte-identical to today.
 *   - Guard ON but the throttle RPC errors/throws (or the RPCs are absent
 *     in the DB) → FAIL OPEN: the operation proceeds, the error is logged.
 *     This is deliberate: a throttle-store blip must never lock users out of
 *     login. For verify, failing open never grants access — the OTP must
 *     still match an unexpired otp_requests row downstream.
 *
 * The decision core (evaluateSend / evaluateVerifyLock) is dependency-
 * injected so it is unit-testable with a fake RPC and no database — see
 * web/e2e/otp-guard.spec.ts.
 *
 * Thresholds live in the SQL RPCs (web/supabase/migrations/*_otp_throttle.sql):
 *   send:   >= 30s between sends; <= 5 / rolling 60 min.
 *   verify: <= 5 failed / rolling 10 min -> lock 15 min; success clears.
 */

import { adminSupabase } from "@/lib/supabase/admin";

function envFlagOn(value: string | undefined): boolean {
  const v = String(value ?? "").trim().toLowerCase();
  return v === "true" || v === "1";
}

export function isOtpSendGuardEnabled(): boolean {
  return envFlagOn(process.env.KK_OTP_SEND_GUARD_ENABLED);
}

export function isOtpVerifyGuardEnabled(): boolean {
  return envFlagOn(process.env.KK_OTP_VERIFY_GUARD_ENABLED);
}

export type SendDecision = {
  allowed: boolean;
  retryAfterSeconds: number;
  reason: string;
  /** true when the guard flag was OFF (no RPC call made). */
  skipped?: boolean;
  /** true when the RPC failed and we allowed the send anyway. */
  failOpen?: boolean;
};

export type LockDecision = {
  locked: boolean;
  retryAfterSeconds: number;
  skipped?: boolean;
  failOpen?: boolean;
};

type SendRpcResult =
  | { allowed?: boolean; retry_after_seconds?: number; reason?: string }
  | null;

type LockRpcResult = { locked?: boolean; retry_after_seconds?: number } | null;

/**
 * Pure decision core for the SEND guard. Injectable RPC caller so it can be
 * unit-tested without a database.
 *   - enabled === false        → allowed, skipped (RPC never called)
 *   - callRpc resolves         → map allowed/retry_after_seconds/reason
 *   - callRpc throws           → allowed, failOpen (logged)
 * Default-allow on any ambiguous RPC shape (fail-open philosophy).
 */
export async function evaluateSend(opts: {
  enabled: boolean;
  phone: string;
  callRpc: (phone: string) => Promise<SendRpcResult>;
}): Promise<SendDecision> {
  if (!opts.enabled) {
    return { allowed: true, retryAfterSeconds: 0, reason: "guard_disabled", skipped: true };
  }
  try {
    const r = await opts.callRpc(opts.phone);
    const allowed = r?.allowed !== false; // undefined/null → allow (fail-open)
    return {
      allowed,
      retryAfterSeconds: Math.max(0, Number(r?.retry_after_seconds ?? 0) || 0),
      reason: String(r?.reason ?? (allowed ? "allowed" : "rate_limited")),
    };
  } catch (err) {
    console.error(
      "[otp/throttle] send guard RPC failed — failing open",
      err instanceof Error ? err.message : err
    );
    return { allowed: true, retryAfterSeconds: 0, reason: "fail_open", failOpen: true };
  }
}

/**
 * Pure decision core for the VERIFY lock check. Same injection contract.
 *   - enabled === false        → not locked, skipped
 *   - callRpc resolves         → locked only when explicitly true
 *   - callRpc throws           → not locked, failOpen (logged)
 */
export async function evaluateVerifyLock(opts: {
  enabled: boolean;
  phone: string;
  callRpc: (phone: string) => Promise<LockRpcResult>;
}): Promise<LockDecision> {
  if (!opts.enabled) {
    return { locked: false, retryAfterSeconds: 0, skipped: true };
  }
  try {
    const r = await opts.callRpc(opts.phone);
    const locked = r?.locked === true; // only an explicit lock blocks (fail-open)
    return {
      locked,
      retryAfterSeconds: Math.max(0, Number(r?.retry_after_seconds ?? 0) || 0),
    };
  } catch (err) {
    console.error(
      "[otp/throttle] verify lock RPC failed — failing open",
      err instanceof Error ? err.message : err
    );
    return { locked: false, retryAfterSeconds: 0, failOpen: true };
  }
}

// ── Production RPC callers (bind the injected core to Supabase) ──────────────

async function sendRpc(phone: string): Promise<SendRpcResult> {
  const { data, error } = await adminSupabase.rpc("otp_note_send", { p_phone: phone });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) as SendRpcResult;
}

async function lockRpc(phone: string): Promise<LockRpcResult> {
  const { data, error } = await adminSupabase.rpc("otp_check_locked", { p_phone: phone });
  if (error) throw new Error(error.message);
  return (Array.isArray(data) ? data[0] : data) as LockRpcResult;
}

/** SEND guard for /api/send-whatsapp-otp. Phone must be normalized (91XXXXXXXXXX). */
export function guardSend(phone: string): Promise<SendDecision> {
  return evaluateSend({ enabled: isOtpSendGuardEnabled(), phone, callRpc: sendRpc });
}

/** VERIFY lock check for /api/verify-otp. Phone must be normalized. */
export function guardVerifyLock(phone: string): Promise<LockDecision> {
  return evaluateVerifyLock({ enabled: isOtpVerifyGuardEnabled(), phone, callRpc: lockRpc });
}

/**
 * Record a failed verify attempt. No-op when the verify guard is off.
 * Fully soft-fail: a throttle write error must never change the verify
 * outcome the caller is about to return.
 */
export async function noteVerifyFailure(phone: string): Promise<void> {
  if (!isOtpVerifyGuardEnabled()) return;
  try {
    const { error } = await adminSupabase.rpc("otp_note_verify_failure", { p_phone: phone });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(
      "[otp/throttle] noteVerifyFailure failed (non-fatal)",
      err instanceof Error ? err.message : err
    );
  }
}

/** Clear failure counter + lock after a successful verify. No-op when guard off. */
export async function clearVerify(phone: string): Promise<void> {
  if (!isOtpVerifyGuardEnabled()) return;
  try {
    const { error } = await adminSupabase.rpc("otp_clear_verify", { p_phone: phone });
    if (error) throw new Error(error.message);
  } catch (err) {
    console.error(
      "[otp/throttle] clearVerify failed (non-fatal)",
      err instanceof Error ? err.message : err
    );
  }
}
