import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      rawCategoryInput,
      bestMatch,
      confidence,
      time,
      area,
      details,
      createdAt,
    } = body || {};

    const session = getAuthSession({
      cookie: request.headers.get("cookie") ?? "",
    });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!rawCategoryInput || !area) {
      return NextResponse.json(
        { error: "Required fields missing: Category or Area" },
        { status: 400 }
      );
    }

    const GOOGLE_SCRIPT_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;
    if (!GOOGLE_SCRIPT_URL) {
      throw new Error(
        "NEXT_PUBLIC_APPS_SCRIPT_URL is missing in environment variables"
      );
    }

    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        action: "submit_category_approval",
        rawCategoryInput: rawCategoryInput,
        bestMatch: bestMatch || "",
        confidence: typeof confidence === "number" ? confidence : 0,
        time: time || "",
        area: area,
        details: details || "",
        createdAt: createdAt || new Date().toISOString(),
      }),
    });

    const text = await response.text();
    if (!text.startsWith("{")) {
      console.error("Script Error Response:", text);
      return NextResponse.json(
        { error: "Script returned an error. Check Apps Script logs." },
        { status: 502 }
      );
    }

    const result = JSON.parse(text);
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    console.error("API Route Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
