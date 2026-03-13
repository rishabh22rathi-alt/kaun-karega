import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MASKED_TOKEN_TAIL = 6;

function maskToken(token: string) {
  if (token.length <= MASKED_TOKEN_TAIL) return "***";
  return `${token.slice(0, 4)}...${token.slice(-MASKED_TOKEN_TAIL)}`;
}

export async function GET() {
  try {
    const token = process.env.META_WA_TOKEN;
    const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID;

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing env: META_WA_TOKEN" },
        { status: 500 }
      );
    }
    if (!phoneNumberId) {
      return NextResponse.json(
        { ok: false, error: "Missing env: META_WA_PHONE_NUMBER_ID" },
        { status: 500 }
      );
    }

    const to = "91XXXXXXXXXX";
    const url = `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`;

    console.log("[WA TEST] sending", {
      url,
      token: maskToken(token),
    });

    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: "hello_world",
        language: { code: "en_US" },
      },
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    const responseText = await response.text();
    let responseBody: unknown = responseText;

    if (responseText) {
      try {
        responseBody = JSON.parse(responseText);
      } catch {
        responseBody = responseText;
      }
    }

    if (!response.ok) {
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

    return NextResponse.json({ ok: true, meta: responseBody });
  } catch (err: any) {
    console.error("[WA TEST ERROR]", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
