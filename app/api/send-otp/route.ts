import { saveOTP } from "@/lib/googleSheets";
import { normalizePhone } from "@/lib/utils/phone";
import { sendOtpMessage } from "@/lib/notifications";

type OtpRequestBody = {
  phone?: string;
};

const isTenDigitPhone = (phone: string): boolean =>
  /^\d{10}$/.test(phone.trim());

const generateOtp = (): string =>
  Math.floor(1000 + Math.random() * 9000).toString();

export async function POST(req: Request): Promise<Response> {
  try {
    const { phone }: OtpRequestBody = await req.json();

    if (!phone || typeof phone !== "string" || !isTenDigitPhone(phone)) {
      return Response.json(
        { success: false, error: "Phone must be a 10-digit number." },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return Response.json(
        { success: false, error: "Invalid phone number." },
        { status: 400 }
      );
    }

    const otp = generateOtp();

    await saveOTP(normalizedPhone, otp);
    await sendOtpMessage(normalizedPhone, otp);

    return Response.json({ success: true, otp });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return Response.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
