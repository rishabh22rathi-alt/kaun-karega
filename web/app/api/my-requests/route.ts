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
    if (!response.ok || result?.ok !== true) {
      return NextResponse.json(result, { status: response.status || 500 });
    }

    const adminResponse = await fetch(scriptUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify({
        action: "get_admin_requests",
      }),
    });

    const adminText = await adminResponse.text();
    const adminResult = adminText.startsWith("{") ? JSON.parse(adminText) : null;
    const adminRequests = Array.isArray(adminResult?.requests) ? adminResult.requests : [];
    const byTaskId = new Map(
      adminRequests.map((item: any) => [String(item?.TaskID || "").trim(), item || {}])
    );

    const requests = Array.isArray(result?.requests) ? result.requests : [];
    const mergedRequests = requests.map((item: any) => {
      const taskId = String(item?.TaskID || item?.taskId || "").trim();
      const adminItem = (byTaskId.get(taskId) || {}) as {
        MatchedProviders?: unknown[];
        RespondedProvider?: string;
        RespondedProviderName?: string;
      };

      return {
        ...item,
        MatchedProviders: Array.isArray(adminItem?.MatchedProviders)
          ? adminItem.MatchedProviders
          : [],
        RespondedProvider: String(adminItem?.RespondedProvider || "").trim(),
        RespondedProviderName: String(adminItem?.RespondedProviderName || "").trim(),
      };
    });

    return NextResponse.json({
      ...result,
      requests: mergedRequests,
    });
  } catch (error: any) {
    console.error("My requests error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
