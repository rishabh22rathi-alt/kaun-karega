import { saveOTP } from "@/lib/googleSheets";
import { sendOtpMessage } from "@/lib/notifications";
import { normalizePhone } from "@/lib/utils/phone";

function generateOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export async function POST(req: Request) {
   console.log('Khushbu Whats app');
  try {
    console.log('Try Send Entered');
    const { phone } = await req.json();
    const normalizedPhone = normalizePhone(phone || "");

    if (!normalizedPhone) {
      return Response.json(
        { success: false, error: "Invalid phone number" },
        { status: 400 }
      );
    }

    const otp = generateOtp();
    console.log("[OTP] Generated OTP", { normalizedPhone, otp });

    await sendOtpMessage(normalizedPhone, otp);
    await saveOTP(normalizedPhone, otp);

    return Response.json({ success: true });
  } catch (error) {
    console.error("[OTP] WhatsApp OTP Error:", error);
    const message = error instanceof Error ? error.message : "Internal error";
    return Response.json({ success: false, error: message }, { status: 500 });
  }
}
