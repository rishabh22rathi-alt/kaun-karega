import path from "path";
import { config as loadEnv } from "dotenv";
import { NextResponse } from "next/server";
import { hasOTPRequestId, saveOTP } from "@/lib/googleSheets";

export const runtime = "nodejs";

const DEDUPE_WINDOW_MS = 2000;
const recentRequestIds = new Map<string, number>();

// Ensure .env.local is loaded when running in server environment (e.g., local dev)
loadEnv({ path: path.join(process.cwd(), ".env.local") });

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch (error) {
      console.error("[SEND OTP] Invalid JSON body", error);
      return NextResponse.json(
        { ok: false, error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    const phoneNumber =
      typeof body?.phoneNumber === "string" ? body.phoneNumber : "";
    const requestId =
      typeof body?.requestId === "string" ? body.requestId : "";
    if (!phoneNumber) {
      return NextResponse.json(
        { ok: false, error: "Phone number is required" },
        { status: 400 }
      );
    }

    const digitsOnly = phoneNumber.replace(/\D/g, "");
    let normalized: string | null = null;

    if (digitsOnly.length === 10) {
      normalized = `91${digitsOnly}`;
    } else if (digitsOnly.length === 12 && digitsOnly.startsWith("91")) {
      normalized = digitsOnly;
    }

    if (!normalized) {
      return NextResponse.json(
        { ok: false, error: "Enter a valid 10-digit Indian mobile number" },
        { status: 400 }
      );
    }

    if (!process.env.META_WA_TOKEN) {
      return NextResponse.json(
        { ok: false, error: "Missing env: META_WA_TOKEN" },
        { status: 500 }
      );
    }
    if (!process.env.META_WA_TEMPLATE) {
      return NextResponse.json(
        { ok: false, error: "Missing env: META_WA_TEMPLATE" },
        { status: 500 }
      );
    }

    const effectiveRequestId = requestId || crypto.randomUUID();
    const nowMs = Date.now();
    if (effectiveRequestId) {
      const lastSeen = recentRequestIds.get(effectiveRequestId);
      if (lastSeen && nowMs - lastSeen < DEDUPE_WINDOW_MS) {
        console.warn("[SEND OTP] Duplicate requestId", {
          requestId: effectiveRequestId,
          ageMs: nowMs - lastSeen,
        });
        return NextResponse.json(
          {
            ok: true,
            message: "OTP already created",
            requestId: effectiveRequestId,
            deduped: true,
          },
          { status: 200 }
        );
      }
      recentRequestIds.set(effectiveRequestId, nowMs);
    }
    for (const [id, ts] of recentRequestIds) {
      if (nowMs - ts > DEDUPE_WINDOW_MS) {
        recentRequestIds.delete(id);
      }
    }

    const istTimestamp = new Date().toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
    });
    const alreadyExists = await hasOTPRequestId(effectiveRequestId);
    if (alreadyExists) {
      return NextResponse.json({
        ok: true,
        message: "OTP already created",
        requestId: effectiveRequestId,
        deduped: true,
        timestamp: istTimestamp,
      });
    }

    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    await saveOTP(normalized, otp, effectiveRequestId, istTimestamp);

    const phoneNumberId =
      process.env.META_WA_PHONE_NUMBER_ID || process.env.META_WA_PHONE_ID || "";
    if (!phoneNumberId) {
      return NextResponse.json(
        { ok: false, error: "Missing env: META_WA_PHONE_NUMBER_ID" },
        { status: 500 }
      );
    }

    const rawTemplate = process.env.META_WA_TEMPLATE ?? "";
    const templateName = rawTemplate.includes("=")
      ? rawTemplate.split("=").pop()?.trim() ?? ""
      : rawTemplate.trim();

    if (!templateName) {
      return NextResponse.json(
        { ok: false, error: "Missing env: META_WA_TEMPLATE" },
        { status: 500 }
      );
    }

    const languageCode = process.env.META_WA_LANG?.trim() || "en_US";
    const apiEndpoint = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;
    const components = [
      {
        type: "body",
        parameters: [
          {
            type: "text",
            text: otp,
          },
        ],
      },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [
          {
            type: "text",
            text: otp,
          },
        ],
      },
    ];

    const payload = {
      messaging_product: "whatsapp",
      to: normalized,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    };

    console.log("[WA] sending template", {
      to: normalized,
      templateName,
      langCode: languageCode,
    });
    console.log(
      "[WA] payload keys",
      Object.keys(payload),
      Object.keys(payload.template)
    );

    const response = await fetch(apiEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.META_WA_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    let responseBody: unknown = null;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = null;
    }

    if (!response.ok) {
      console.error("[WHATSAPP API ERROR]", {
        status: response.status,
        body: responseBody,
      });
      return NextResponse.json(
        {
          ok: false,
          error: "WhatsApp API error",
          details: responseBody,
          status: response.status,
        },
        { status: response.status }
      );
    }

    console.log("[WHATSAPP OK]", responseBody);
    return NextResponse.json({
      ok: true,
      message: "OTP sent successfully",
      meta: responseBody,
      timestamp: istTimestamp,
      requestId: effectiveRequestId,
    });
  } catch (err: any) {
    console.error("[SEND WHATSAPP OTP ERROR]", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
