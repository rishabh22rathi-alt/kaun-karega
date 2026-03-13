import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const session = getAuthSession({
      cookie: request.headers.get("cookie") ?? "",
    });

    if (!session?.phone) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    const scriptUrl = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;
    if (!scriptUrl) {
      throw new Error("Missing Apps Script URL in .env");
    }

    const response = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        action: "get_user_requests",
        phone: session.phone,
      }),
    });

    const text = await response.text();
    if (!text.startsWith("{")) {
      console.error("Script Error Response:", text);
      return NextResponse.json(
        { ok: false, error: "Script returned an error." },
        { status: 500 }
      );
    }

    const result = JSON.parse(text);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("My requests error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
