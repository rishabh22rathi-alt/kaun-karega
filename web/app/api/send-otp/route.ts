import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Single canonical phone format for the OTP system: 12-digit `91XXXXXXXXXX`.
// Accept either the user's raw 10-digit input or an already-prefixed value
// and normalise before any DB write. Mirrors the logic in
// /api/send-whatsapp-otp and /api/verify-otp so all three routes write and
// match against the same shape.
function normalizeIndianPhone(value: string): string | null {
  const digitsOnly = String(value || "").replace(/\D/g, "");
  if (digitsOnly.length === 10) return `91${digitsOnly}`;
  if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) return digitsOnly;
  return null;
}

export async function POST(request: Request) {
  let body: { toPhoneNumber?: unknown; phone?: unknown; requestId?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Accept both toPhoneNumber (legacy callers) and phone
  const rawPhone =
    typeof body.toPhoneNumber === "string"
      ? body.toPhoneNumber.trim()
      : typeof body.phone === "string"
      ? body.phone.trim()
      : "";

  if (!rawPhone) {
    return NextResponse.json({ success: false, error: "Phone number required" }, { status: 400 });
  }

  const normalizedPhone = normalizeIndianPhone(rawPhone);
  if (!normalizedPhone) {
    return NextResponse.json(
      { success: false, error: "Enter a valid 10-digit Indian mobile number" },
      { status: 400 }
    );
  }

  const requestId =
    typeof body.requestId === "string" && body.requestId.trim()
      ? body.requestId.trim()
      : crypto.randomUUID();

  const otp = String(Math.floor(1000 + Math.random() * 9000));
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error } = await adminSupabase.from("otp_requests").insert({
    phone: normalizedPhone,
    otp,
    request_id: requestId,
    is_verified: false,
    expires_at: expiresAt,
  });

  if (error) {
    console.error("[SEND OTP] insert error", error);
    return NextResponse.json({ success: false, error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ success: true, otpSaved: true, requestId });
}
