import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";

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

  return NextResponse.json({ success: true, phone });
}
