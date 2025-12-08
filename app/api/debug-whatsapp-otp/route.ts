import { NextRequest } from "next/server";
import { sendOtpMessage } from "@/lib/notifications";

export async function GET(req: NextRequest) {
  try {
    const phone = req.nextUrl.searchParams.get("phone");
    const otp = req.nextUrl.searchParams.get("otp") ?? "123456";

    if (!phone) {
      return Response.json(
        { ok: false, error: "Missing 'phone' query parameter" },
        { status: 400 }
      );
    }

    console.log("[DEBUG OTP] Sending test OTP", { phone, otp });

    const result = await sendOtpMessage(phone, otp);

    return Response.json({ ok: true, result });
  } catch (error) {
    console.error("[DEBUG OTP] Error sending test OTP", error);
    const message =
      error instanceof Error ? error.message : "Internal error in debug OTP";

    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET(req as NextRequest);
}
