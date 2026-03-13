import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { fetchProviderMatches } from "@/lib/api/providerMatching";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // Destructure the data coming from your frontend component
    const category = typeof body?.category === "string" ? body.category.trim() : "";
    const area = typeof body?.area === "string" ? body.area.trim() : "";
    let details = (body?.details ?? body?.description ?? "").toString().trim();
    if (!details) {
      details = "-";
    }
    const phone = body?.phone;
    // Task submission now depends on auth session only.
    if (phone !== undefined) {
      return NextResponse.json(
        { error: "Phone must come from the auth session." },
        { status: 400 }
      );
    }

    const session = getAuthSession({
      cookie: request.headers.get("cookie") ?? "",
    });
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Validation: Ensure we don't send empty data
    if (!category || !area) {
      return NextResponse.json(
        { error: "Required fields missing: Category or Area" },
        { status: 400 }
      );
    }

    const GOOGLE_SCRIPT_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;

    if (!GOOGLE_SCRIPT_URL) {
      throw new Error("NEXT_PUBLIC_APPS_SCRIPT_URL is missing in environment variables");
    }

    // Forward the data to Google Apps Script
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        action: "submit_task", // Tells the script which logic to trigger
        category: category,
        area: area,
        details,
        phone: session.phone,
      }),
    });

    const scriptStatus = response.status;
    const scriptBodyText = await response.text();
    console.log("submit-request Apps Script response", {
      status: scriptStatus,
      body: scriptBodyText,
    });

    if (!response.ok) {
      let scriptError = scriptBodyText;
      try {
        const parsed = JSON.parse(scriptBodyText);
        scriptError = parsed?.error || parsed?.message || scriptBodyText;
      } catch {}
      return NextResponse.json(
        { error: scriptError || `Apps Script write failed (status ${scriptStatus}).` },
        { status: 500 }
      );
    }

    let result: any = null;
    try {
      result = JSON.parse(scriptBodyText);
    } catch {
      return NextResponse.json(
        { error: "Apps Script returned non-JSON response." },
        { status: 500 }
      );
    }

    if (result?.ok !== true) {
      return NextResponse.json(
        { error: result?.error || result?.message || "Apps Script returned failure." },
        { status: 500 }
      );
    }

    const taskId =
      typeof result?.taskId === "string" ? result.taskId.trim() : "";
    if (!taskId) {
      return NextResponse.json(
        { error: "Apps Script did not return taskId." },
        { status: 500 }
      );
    }

    try {
      const matched = await fetchProviderMatches({
        category,
        area,
        taskId,
        userPhone: session.phone,
        limit: 20,
      });

      const persistResponse = await fetch(GOOGLE_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify({
          action: "save_provider_matches",
          taskId,
          category,
          area,
          details,
          providers: matched.providers,
        }),
      });

      if (!persistResponse.ok) {
        const persistBody = await persistResponse.text();
        console.error("save_provider_matches failed", {
          taskId,
          status: persistResponse.status,
          body: persistBody,
        });
      } else {
        const persistText = await persistResponse.text();
        console.log("save_provider_matches response", {
          taskId,
          body: persistText,
        });
      }
    } catch (persistError) {
      console.error("Provider match persistence failed", {
        taskId,
        error: persistError instanceof Error ? persistError.message : persistError,
      });
    }

    return NextResponse.json({
      ok: true,
      taskId,
    });

  } catch (error: any) {
    console.error("API Route Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
