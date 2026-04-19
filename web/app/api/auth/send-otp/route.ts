import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: { phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  if (!phone) {
    return NextResponse.json({ success: false, error: "phone is required" }, { status: 400 });
  }

  const otp = String(Math.floor(1000 + Math.random() * 9000));
  const requestId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();

  const { error } = await adminSupabase.from("otp_requests").insert({
    phone,
    otp,
    request_id: requestId,
    is_verified: false,
    expires_at: expiresAt,
  });

  if (error) {
    console.error("[SEND OTP] insert error", error);
    return NextResponse.json({ success: false, error: "Database error" }, { status: 500 });
  }

  return NextResponse.json({ success: true, requestId, phone });
}
