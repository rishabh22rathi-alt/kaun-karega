import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";

function getTodayDateInKolkata() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function normalizeDateOnly(value: string) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;

  const dmyMatch = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;

  return "";
}

export async function POST(request: Request) {
  const routeStartMs = Date.now();
  try {
    const body = await request.json();
    const bodyParsedMs = Date.now();
    // Destructure the data coming from your frontend component
    const category = typeof body?.category === "string" ? body.category.trim() : "";
    const area = typeof body?.area === "string" ? body.area.trim() : "";
    const selectedTimeframe =
      typeof body?.time === "string"
        ? body.time.trim()
        : typeof body?.urgency === "string"
          ? body.urgency.trim()
          : "";
    const serviceDate =
      typeof body?.serviceDate === "string" ? body.serviceDate.trim() : "";
    const normalizedServiceDate = normalizeDateOnly(serviceDate);
    const timeSlot =
      typeof body?.timeSlot === "string" ? body.timeSlot.trim() : "";
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

    const todayDate = getTodayDateInKolkata();
    if (serviceDate && (!normalizedServiceDate || normalizedServiceDate < todayDate)) {
      console.log("submit-request rejected past date", {
        rawDate: serviceDate,
        normalizedDate: normalizedServiceDate,
        todayDate,
        reason: !normalizedServiceDate
          ? "INVALID_SERVICE_DATE_FORMAT"
          : "SERVICE_DATE_BEFORE_TODAY",
      });
      return NextResponse.json(
        { ok: false, message: "Please select today or a future date." },
        { status: 400 }
      );
    }

    const GOOGLE_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

    if (!GOOGLE_SCRIPT_URL) {
      throw new Error("APPS_SCRIPT_URL is missing in environment variables");
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
        selectedTimeframe,
        serviceDate: normalizedServiceDate,
        timeSlot,
      }),
    });
    const scriptResponseMs = Date.now();

    const scriptStatus = response.status;
    const scriptBodyText = await response.text();
    const scriptBodyReadMs = Date.now();
    console.log("submit-request Apps Script response", {
      status: scriptStatus,
      body: scriptBodyText,
      bodyParseElapsedMs: bodyParsedMs - routeStartMs,
      appsScriptFetchElapsedMs: scriptResponseMs - bodyParsedMs,
      appsScriptBodyReadElapsedMs: scriptBodyReadMs - scriptResponseMs,
      routeElapsedMsSoFar: scriptBodyReadMs - routeStartMs,
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
      const validationMessage =
        result?.message === "Please select today or a future date."
          ? result.message
          : "";
      return NextResponse.json(
        validationMessage
          ? { ok: false, message: validationMessage }
          : { error: result?.error || result?.message || "Apps Script returned failure." },
        { status: validationMessage ? 400 : 500 }
      );
    }

    const taskId =
      typeof result?.taskId === "string" ? result.taskId.trim() : "";
    const displayId =
      typeof result?.displayId === "string" || typeof result?.displayId === "number"
        ? String(result.displayId).trim()
        : "";
    if (!taskId) {
      return NextResponse.json(
        { error: "Apps Script did not return taskId." },
        { status: 500 }
      );
    }

    console.log("submit-request route timing", {
      taskId,
      category,
      area,
      bodyParseElapsedMs: bodyParsedMs - routeStartMs,
      appsScriptFetchElapsedMs: scriptResponseMs - bodyParsedMs,
      appsScriptBodyReadElapsedMs: scriptBodyReadMs - scriptResponseMs,
      totalElapsedMsBeforeResponse: Date.now() - routeStartMs,
      deferredNotificationProcessing: true,
    });

    return NextResponse.json({
      ok: true,
      taskId,
      displayId,
    });

  } catch (error: any) {
    const routeErrorMs = Date.now();
    console.error("API Route Error:", error);
    console.error("submit-request route timing failed", {
      totalElapsedMs: routeErrorMs - routeStartMs,
    });
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
