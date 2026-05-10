import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adminSupabase } from "@/lib/supabase/admin";
// CHANGE: import alias resolver so submitted task category is normalized
// (e.g. "lohar" → "welder") before the categories-table canonicalization.
// Detail-aware variant lets us also persist the original alias the user
// typed (e.g. "dentist") into tasks.work_tag for specialization-aware
// matching downstream.
import { resolveCategoryAliasDetailed } from "@/lib/categoryAliases";
import { isDisclaimerFresh } from "@/lib/disclaimer";

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

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
    // CHANGE: resolve user-typed alias to canonical category before persisting.
    // The downstream categories-table lookup will further canonicalize casing.
    const rawCategory = typeof body?.category === "string" ? body.category.trim() : "";
    // Detail-aware resolve: capture the alias the user actually typed so we
    // can persist it on tasks.work_tag for specialization-aware matching.
    // matchedAlias is null when the user typed a canonical directly or an
    // unknown term — both fall back to the existing broad-matching path.
    const { canonical: category, matchedAlias } =
      await resolveCategoryAliasDetailed(rawCategory);
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

    const session = await getAuthSession({
      cookie: request.headers.get("cookie") ?? "",
    });
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 }
      );
    }

    // Server-side disclaimer-freshness gate. The homepage modal is the
    // UX surface; this is the trusted enforcement point. A client that
    // skipped or stripped the modal cannot submit. profiles.phone is
    // historically stored in both 10-digit and 12-digit (91-prefixed)
    // forms depending on which OTP-verify route wrote it, so the lookup
    // unions both. Service-role client mirrors the my-requests precedent
    // (profiles is RLS-protected).
    //
    // Fail-closed on DB error: a transient Supabase outage returns
    // DISCLAIMER_REQUIRED rather than 500, so the homepage's silent
    // modal-reopen path covers the recovery instead of a scary toast.
    const sessionPhoneRaw = String(session.phone || "");
    const sessionPhone10 = sessionPhoneRaw.replace(/\D/g, "").slice(-10);
    const phoneVariants =
      sessionPhone10.length === 10
        ? [sessionPhone10, `91${sessionPhone10}`]
        : sessionPhoneRaw.trim()
          ? [sessionPhoneRaw.trim()]
          : [];

    let disclaimerFresh = false;
    if (phoneVariants.length > 0) {
      const { data: profileRows, error: profileErr } = await adminSupabase
        .from("profiles")
        .select("disclaimer_version, disclaimer_accepted_at")
        .in("phone", phoneVariants);

      if (profileErr) {
        console.warn(
          "[submit-request] disclaimer lookup failed; failing closed",
          profileErr.message || profileErr
        );
      } else {
        const now = Date.now();
        for (const raw of profileRows ?? []) {
          if (
            isDisclaimerFresh(
              {
                disclaimer_version:
                  (raw as { disclaimer_version?: string | null })
                    .disclaimer_version ?? null,
                disclaimer_accepted_at:
                  (raw as { disclaimer_accepted_at?: string | null })
                    .disclaimer_accepted_at ?? null,
              },
              now
            )
          ) {
            disclaimerFresh = true;
            break;
          }
        }
      }
    }

    if (!disclaimerFresh) {
      return NextResponse.json(
        { ok: false, error: "DISCLAIMER_REQUIRED" },
        { status: 403 }
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

    // Canonicalize category to its master `categories.name` casing if a row
    // exists. Prevents downstream matching from depending on whatever case
    // the user typed. Falls back to the trimmed input when the category does
    // not exist in master (e.g. fresh custom request) — the same behaviour
    // as before this change.
    let canonicalCategory = category;
    try {
      const { data: categoryRow } = await supabase
        .from("categories")
        .select("name")
        .ilike("name", category)
        .eq("active", true)
        .maybeSingle();
      if (categoryRow?.name) {
        canonicalCategory = String(categoryRow.name);
      }
    } catch (lookupError) {
      console.warn(
        "[submit-request] category canonicalisation lookup failed; storing as-typed",
        lookupError instanceof Error ? lookupError.message : lookupError
      );
    }

    const taskId = `TK-${Date.now()}`;
    const insertStartedMs = Date.now();
    // Canonical storage: tasks.phone holds the last 10 digits only.
    // session.phone is the verified `91XXXXXXXXXX` form from the signed
    // cookie — strip the country prefix here so equality filters in
    // /api/my-requests, ownership checks in /api/process-task-notifications,
    // and chat thread joins all line up against the 10-digit value.
    const ownerPhone10 = normalizePhone10(session.phone);
    const { data, error } = await supabase
      .from("tasks")
      .insert({
        task_id: taskId,
        category: canonicalCategory,
        area,
        details,
        phone: ownerPhone10,
        selected_timeframe: selectedTimeframe,
        service_date: normalizedServiceDate || null,
        time_slot: timeSlot || null,
        // Original alias the user typed when it resolved to a different
        // canonical (e.g. "dentist" -> doctor). Null when user typed the
        // canonical directly or an unknown term — broad matching handles
        // those. See migration 20260512100000_tasks_work_tag.sql.
        work_tag: matchedAlias,
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
