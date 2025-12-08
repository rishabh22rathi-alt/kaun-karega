import { verifyOTP } from "@/lib/googleSheets";
import { normalizePhone } from "@/lib/utils/phone";

type VerifyPayload = {
  phone?: string;
  otp?: string;
};

export async function POST(req: Request) {
  try {
    const { phone, otp }: VerifyPayload = await req.json();

    const normalizedPhone = normalizePhone(phone ?? "");

    if (!normalizedPhone || !otp) {
      return Response.json(
        { ok: false, error: "Phone and OTP are required" },
        { status: 400 }
      );
    }

    const sanitizedOtp = String(otp).trim();
    if (!/^\d{4}$/.test(sanitizedOtp)) {
      return Response.json(
        { ok: false, error: "Invalid OTP" },
        { status: 400 }
      );
    }

    const isValid = await verifyOTP(normalizedPhone, sanitizedOtp);

    if (!isValid) {
      return Response.json(
        { ok: false, error: "Invalid OTP" },
        { status: 400 }
      );
    }

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Verify OTP error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
