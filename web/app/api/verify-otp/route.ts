import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { setAuthSessionCookie } from "@/lib/auth";
import { checkAdminByPhone } from "@/lib/adminAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Accept both phone and phoneNumber (legacy callers use both)
  const rawPhone =
    typeof body?.phoneNumber === "string"
      ? body.phoneNumber
      : typeof body?.phone === "string"
      ? body.phone
      : "";
  const otp = typeof body?.otp === "string" ? body.otp.trim() : "";
  const requestId = typeof body?.requestId === "string" ? body.requestId.trim() : "";

  const normalizedPhone = normalizeIndianPhone(rawPhone);
  if (!normalizedPhone) {
    return NextResponse.json(
      { ok: false, error: "Enter a valid 10-digit Indian mobile number" },
      { status: 400 }
    );
  }

  if (!/^\d{4}$/.test(otp)) {
    return NextResponse.json({ ok: false, error: "Invalid OTP" }, { status: 400 });
  }

  let verifiedPhone: string;

  if (requestId) {
    // Primary path: verify via Postgres RPC using requestId + otp
    const { data: rows, error } = await adminSupabase.rpc("verify_otp_and_get_phone", {
      p_request_id: requestId,
      p_otp: otp,
    });

    if (error) {
      console.error("[VERIFY OTP] RPC error", error);
      return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Invalid or expired OTP" }, { status: 400 });
    }

    verifiedPhone = rows[0].phone;
  } else {
    // Fallback path: no requestId supplied (OtpRequestForm.jsx flow) — look up by phone + otp
    const { data: rows, error } = await adminSupabase
      .from("otp_requests")
      .select("id, phone")
      .eq("phone", normalizedPhone)
      .eq("otp", otp)
      .eq("is_verified", false)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    if (error) {
      console.error("[VERIFY OTP] lookup error", error);
      return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
    }

    if (!rows || rows.length === 0) {
      return NextResponse.json({ ok: false, error: "Invalid or expired OTP" }, { status: 400 });
    }

    // Mark as verified so it can't be replayed
    const { error: markError } = await adminSupabase
      .from("otp_requests")
      .update({ is_verified: true })
      .eq("id", rows[0].id);

    if (markError) {
      console.error("[VERIFY OTP] mark-verified error", markError);
      return NextResponse.json({ ok: false, error: "Database error" }, { status: 500 });
    }

    verifiedPhone = rows[0].phone;
  }

  // Upsert profile — non-fatal if it fails, but still report it
  const { error: upsertError } = await adminSupabase.from("profiles").upsert(
    { phone: verifiedPhone, role: "user", last_login_at: new Date().toISOString() },
    { onConflict: "phone" }
  );
  if (upsertError) {
    console.error("[VERIFY OTP] profile upsert error", upsertError);
    return NextResponse.json({ ok: false, error: "Profile update failed" }, { status: 500 });
  }

  // Admin check — non-blocking; failure never breaks the login flow
  let adminInfo: {
    isAdmin: boolean;
    adminName?: string | null;
    adminRole?: string | null;
    permissions?: string[];
  } = { isAdmin: false };
  try {
    const adminResult = await checkAdminByPhone(normalizedPhone);
    if (adminResult.ok) {
      adminInfo = {
        isAdmin: true,
        adminName: adminResult.admin.name ?? null,
        adminRole: adminResult.admin.role ?? null,
        permissions: adminResult.admin.permissions ?? [],
      };
    }
  } catch {
    // ignore — isAdmin stays false
  }

  const response = NextResponse.json({
    ok: true,
    phone: verifiedPhone,
    message: "Verified",
    ...adminInfo,
  });

  const cookieSet = await setAuthSessionCookie(response, {
    phone: verifiedPhone,
    verified: true,
    createdAt: Date.now(),
  });
  if (!cookieSet) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Server misconfigured: AUTH_SESSION_SECRET is missing. Cannot establish session.",
      },
      { status: 500 }
    );
  }

  // kk_admin is a UI-only hint (sidebar, /admin redirect convenience). All
  // admin API routes still re-verify via requireAdminSession against the
  // admins table — this cookie alone never grants admin access.
  if (adminInfo.isAdmin) {
    response.cookies.set("kk_admin", "1", {
      maxAge: 30 * 24 * 60 * 60,
      path: "/",
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
    });
  } else {
    response.cookies.set("kk_admin", "", { maxAge: 0, path: "/" });
  }

  return response;
}

function normalizeIndianPhone(value: string) {
  const digitsOnly = value.replace(/\D/g, "");
  if (digitsOnly.length === 10) return `91${digitsOnly}`;
  if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) return digitsOnly;
  return null;
}
