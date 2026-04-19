import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

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

    const supabase = await createClient();
    const taskId = `TK-${Date.now()}`;
    const insertStartedMs = Date.now();
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        task_id: taskId,
        category,
        area,
        details,
        phone: session.phone,
        selected_timeframe: selectedTimeframe,
        service_date: normalizedServiceDate || null,
        time_slot: timeSlot || null,
        status: "submitted",
      })
      .select("display_id")
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message || "Failed to insert task." },
        { status: 500 }
      );
    }

    const displayId =
      typeof data?.display_id === "string" || typeof data?.display_id === "number"
        ? String(data.display_id).trim()
        : "";

    console.log("submit-request route timing", {
      taskId,
      category,
      area,
      bodyParseElapsedMs: bodyParsedMs - routeStartMs,
      supabaseInsertElapsedMs: Date.now() - insertStartedMs,
      totalElapsedMsBeforeResponse: Date.now() - routeStartMs,
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
