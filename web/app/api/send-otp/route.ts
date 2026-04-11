// app/api/send-otp/route.ts

import "dotenv/config";
import { NextResponse } from "next/server";
// Assuming this utility is where you handle the WhatsApp API call
import { sendOtpMessage } from "../../../components/lib/utils/whatsapp-sender";

// Helper to generate a random 4-digit number
function generateFourDigitOTP(): string {
    // Generates a random integer between 1000 and 9999 (inclusive)
    const otp = Math.floor(1000 + Math.random() * 9000);
    return otp.toString();
}

export async function POST(request: Request) {
    if (!process.env.META_WA_TOKEN) {
        return NextResponse.json({ error: "Server Configuration Error" }, { status: 500 });
    }

    try {
        const parsed = await request.json();
        const { toPhoneNumber, buttonUrl, requestId } = parsed ?? {};

        if (!toPhoneNumber) {
            return NextResponse.json({ error: "Phone number required" }, { status: 400 });
        }

        const scriptUrl = process.env.APPS_SCRIPT_URL;
        if (!scriptUrl) {
            return NextResponse.json({ error: "Missing Apps Script URL in .env" }, { status: 500 });
        }

        const otpCode = generateFourDigitOTP();

        // --- FIXED PILLAR 3: SAVE TO GOOGLE SCRIPT DIRECTLY ---
        const saveResponse = await fetch(scriptUrl!, {
            method: "POST",
            headers: { "Content-Type": "text/plain" },
            body: JSON.stringify({
                action: "save_otp",
                phone: toPhoneNumber,
                otp: otpCode,
                requestId: requestId
            }),
        });

        const saveResultText = await saveResponse.text();
        console.log("[GOOGLE SCRIPT RESPONSE]:", saveResultText);
        if (!saveResultText.startsWith("{")) {
            return NextResponse.json(
                { error: "Script returned an error. Check Apps Script logs." },
                { status: 502 }
            );
        }

        // 5. Call WhatsApp sender
        const result = await sendOtpMessage(toPhoneNumber, otpCode, buttonUrl);

        return NextResponse.json({ success: true, otpSaved: true, data: result }, { status: 200 });
    } catch (error: any) {
        console.error("API Error:", error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
