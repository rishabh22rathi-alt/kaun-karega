import { NextRequest, NextResponse } from "next/server";
import { sendOtpMessage } from "@/lib/notifications";
import { normalizePhone } from "@/lib/utils/phone";

function generateOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();
    const normalizedPhone = normalizePhone(phone || "");
      console.log('ehre');
    console.log(normalizedPhone);
    if (!normalizedPhone) {
      return NextResponse.json(
        { ok: false, error: "Invalid phone number" },
        { status: 400 }
      );
    }

    const otp = generateOtp();
    console.log("[OTP] Generated OTP:", { normalizedPhone, otp });

    // Send the OTP via WhatsApp
    await sendOtpMessage(normalizedPhone, otp);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[OTP] Send OTP error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
