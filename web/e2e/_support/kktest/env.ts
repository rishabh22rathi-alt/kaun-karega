/**
 * Environment + Supabase client resolution for the KKTEST framework.
 *
 * Mirrors the hand-rolled .env.local parser already used by the live
 * matching specs (provider-plan-listing-matrix.spec.ts) so there is no new
 * runtime dependency — values come from real process.env first, then
 * .env.local as a fallback.
 *
 * This module also owns the PRODUCTION WRITE GUARD. Seeding/reset is
 * destructive-by-nature (guarded to KKTEST rows, but still writes), so it is
 * blocked unless the operator has explicitly opted into a non-prod target.
 * Read-only diagnostics (Data Integrity / Operational Health) do NOT need
 * this guard and run anywhere creds exist.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

let cachedEnvLocal: Record<string, string> | null = null;

function loadEnvLocal(): Record<string, string> {
  if (cachedEnvLocal) return cachedEnvLocal;
  // e2e/_support/kktest -> web/.env.local
  const envPath = path.resolve(__dirname, "../../../.env.local");
  if (!fs.existsSync(envPath)) {
    cachedEnvLocal = {};
    return cachedEnvLocal;
  }
  const env: Record<string, string> = {};
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const sep = trimmed.indexOf("=");
    if (sep === -1) continue;
    env[trimmed.slice(0, sep).trim()] = trimmed
      .slice(sep + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
  }
  cachedEnvLocal = env;
  return cachedEnvLocal;
}

export function getEnv(name: string): string {
  return process.env[name] || loadEnvLocal()[name] || "";
}

export function activeSupabaseUrl(): string {
  return getEnv("SUPABASE_URL") || getEnv("NEXT_PUBLIC_SUPABASE_URL");
}

export function hasServiceRoleCreds(): boolean {
  return Boolean(activeSupabaseUrl() && getEnv("SUPABASE_SERVICE_ROLE_KEY"));
}

/**
 * Service-role admin client. Throws if creds are missing — callers should
 * gate on hasServiceRoleCreds() and skip gracefully when running mocked-only.
 */
export function makeAdminClient(): SupabaseClient {
  const url = activeSupabaseUrl();
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw new Error(
      "KKTEST: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required for live DB access."
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// ─── Production write guard ──────────────────────────────────────────────────

const ALLOWED_WRITE_TARGETS = new Set(["local", "staging", "qa", "test"]);

export function resolveTarget(): string {
  return getEnv("KK_TARGET").trim().toLowerCase();
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

/**
 * Baked-in known PRODUCTION endpoints. Writes are ALWAYS blocked against
 * these — regardless of KK_TARGET or KK_ALLOW_LIVE_SEED. This is the last
 * line of defense: even a mis-set KK_TARGET=staging while still pointed at
 * the prod URL cannot seed/reset. Add new prod/regional URLs here.
 */
export const KNOWN_PRODUCTION_URLS: readonly string[] = [
  "https://ovloeohrjmhrisjhykwj.supabase.co",
];

/**
 * True if `url` is a production endpoint — either a baked-in known URL or the
 * operator-supplied KK_PROD_SUPABASE_URL.
 */
export function isKnownProductionUrl(url: string): boolean {
  const n = normalizeUrl(url);
  if (!n) return false;
  if (KNOWN_PRODUCTION_URLS.some((p) => normalizeUrl(p) === n)) return true;
  const prodUrl = getEnv("KK_PROD_SUPABASE_URL");
  return Boolean(prodUrl && normalizeUrl(prodUrl) === n);
}

/**
 * Throws unless it is safe to WRITE KKTEST rows to the active database.
 *
 * Requires ALL of:
 *   0. The active SUPABASE_URL is NOT a known production endpoint
 *      (baked-in list or KK_PROD_SUPABASE_URL) — checked first, unconditional.
 *   1. KK_ALLOW_LIVE_SEED === "1"  (explicit opt-in)
 *   2. KK_TARGET ∈ {local, staging, qa, test}  (never "production"/empty)
 */
export function assertWritesAllowed(): void {
  // Rule 0 (highest priority): never seed/reset a production URL, full stop.
  const active = activeSupabaseUrl();
  if (isKnownProductionUrl(active)) {
    throw new Error(
      `KKTEST seed/reset PERMANENTLY blocked: active SUPABASE_URL (${
        active || "<unset>"
      }) is a known production endpoint. Point at a staging/local database.`
    );
  }
  if (getEnv("KK_ALLOW_LIVE_SEED") !== "1") {
    throw new Error(
      "KKTEST seed/reset blocked: set KK_ALLOW_LIVE_SEED=1 to allow writes (never on production)."
    );
  }
  const target = resolveTarget();
  if (!ALLOWED_WRITE_TARGETS.has(target)) {
    throw new Error(
      `KKTEST seed/reset blocked: KK_TARGET must be one of local|staging|qa|test (got "${
        target || "<unset>"
      }"). Production writes are never permitted.`
    );
  }
}

export function writesAllowed(): boolean {
  try {
    assertWritesAllowed();
    return true;
  } catch {
    return false;
  }
}

/** Human-readable reason writes are blocked (for skip annotations). */
export function writeBlockReason(): string {
  try {
    assertWritesAllowed();
    return "";
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
