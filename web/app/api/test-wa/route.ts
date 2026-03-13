import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const token = process.env.META_WA_TOKEN;
    const phoneNumberId = process.env.META_WA_PHONE_NUMBER_ID;
    const to = process.env.META_WA_TEST_TO || "";

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
    if (!to) {
      return NextResponse.json(
        { ok: false, error: "Missing env: META_WA_TEST_TO" },
        { status: 500 }
      );
    }

    const payload = {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: "utility_hello_world",
        language: { code: "en_US" },
        components: [
          {
            type: "body",
            parameters: [
              {
                type: "text",
                text: "Hello World",
              },
            ],
          },
        ],
      },
    };

    const response = await fetch(
      `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      }
    );

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
      console.error("[TEST WA ERROR]", {
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

    console.log("[TEST WA OK]", responseBody);
    return NextResponse.json({ ok: true, meta: responseBody });
  } catch (err: any) {
    console.error("[TEST WA ERROR]", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
