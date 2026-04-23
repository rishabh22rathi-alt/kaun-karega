/**
 * Admin verification abstraction.
 *
 * Source of truth: Supabase `admins` table (service-role client).
 * GAS fallback removed in Slice 6 — admins table is the sole authority.
 *
 * Phone format: "91XXXXXXXXXX" (12 chars, no leading "+").
 * This matches the format written into kk_auth_session by the OTP login flow.
 * The admins table must store phones in the same format.
 *
 * See docs/admin-slice-2-notes.md for table schema and seeding instructions.
 */

// Canonical admin session shape. Re-exported by lib/adminAuth.ts so existing
// callers importing AdminSession from there are not broken.
export type AdminSession = {
  phone: string;
  name?: string;
  role?: string;
  permissions?: string[];
};

export type AdminVerifyResult =
  | { ok: true; admin: AdminSession }
  | { ok: false };

// ---------------------------------------------------------------------------
// Supabase-backed verification — sole implementation
// ---------------------------------------------------------------------------

function toCanonical12DigitPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  return digits;
}

async function verifyAdminViaBackend(phone: string): Promise<AdminVerifyResult> {
  try {
    // Dynamic import prevents a module-level crash if env vars are absent
    // during build or in non-server contexts.
    const { adminSupabase } = await import("../supabase/admin");

    const canonicalPhone = toCanonical12DigitPhone(phone);

    const { data, error } = await adminSupabase
      .from("admins")
      .select("phone, name, role, permissions")
      .eq("phone", canonicalPhone)
      .eq("active", true)
      .single();

    if (error || !data) return { ok: false };

    return {
      ok: true,
      admin: {
        phone: String(data.phone),
        name: data.name != null ? String(data.name) : undefined,
        role: data.role != null ? String(data.role) : undefined,
        permissions: Array.isArray(data.permissions) ? (data.permissions as string[]) : [],
      },
    };
  } catch {
    // Supabase unavailable or env missing — treat as not-admin.
    return { ok: false };
  }
}

// ---------------------------------------------------------------------------
// Public interface — all callers use only this function
// ---------------------------------------------------------------------------

/**
 * Verify whether a phone belongs to an active admin.
 *
 * CONTRACT (must be preserved across any future backend changes):
 *   - Never throws
 *   - Returns { ok: true, admin: AdminSession } when found and active
 *   - Returns { ok: false } for unknown phone, inactive admin, or any error
 */
export async function verifyAdminByPhone(phone: string): Promise<AdminVerifyResult> {
  return verifyAdminViaBackend(phone);
}
