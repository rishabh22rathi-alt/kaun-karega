import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { setAuthSessionCookie } from "@/lib/auth";
import { checkAdminByPhone } from "@/lib/adminAuth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { requestId?: unknown; otp?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
  const otp = typeof body.otp === "string" ? body.otp.trim() : "";

  if (!requestId || !otp) {
    return NextResponse.json(
      { success: false, error: "requestId and otp are required" },
      { status: 400 }
    );
  }

  // Call Postgres RPC to verify the OTP and retrieve the associated phone number.
  const { data: otpRows, error: otpError } = await adminSupabase.rpc(
    "verify_otp_and_get_phone",
    { p_request_id: requestId, p_otp: otp }
  );

  if (otpError) {
    console.error("[VERIFY OTP] RPC error", otpError);
    return NextResponse.json({ success: false, error: "Database error" }, { status: 500 });
  }

  if (!otpRows || otpRows.length === 0) {
    return NextResponse.json(
      { success: false, error: "Invalid or expired OTP" },
      { status: 400 }
    );
  }

  const phone: string = otpRows[0].phone;

  const { error: upsertError } = await adminSupabase.from("profiles").upsert(
    { phone, role: "user", last_login_at: new Date().toISOString() },
    { onConflict: "phone" }
  );

  if (upsertError) {
    console.error("[VERIFY OTP] profile upsert error", upsertError);
    return NextResponse.json({ success: false, error: "Profile update failed" }, { status: 500 });
  }

  // Mirror /api/verify-otp: establish the signed session cookie so callers of
  // either route end up with the same trusted server-set session, never a
  // forgeable client-set cookie.
  let isAdmin = false;
  try {
    const adminResult = await checkAdminByPhone(phone);
    if (adminResult.ok) isAdmin = true;
  } catch {
    isAdmin = false;
  }

  const response = NextResponse.json({ success: true, phone, isAdmin });
  const cookieSet = await setAuthSessionCookie(response, {
    phone,
    verified: true,
    createdAt: Date.now(),
  });
  if (!cookieSet) {
    return NextResponse.json(
      {
        success: false,
        error:
          "Server misconfigured: AUTH_SESSION_SECRET is missing. Cannot establish session.",
      },
      { status: 500 }
    );
  }
  if (isAdmin) {
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
