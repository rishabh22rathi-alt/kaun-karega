import { NextRequest, NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type ServerSupabase = Awaited<ReturnType<typeof createClient>>;

type ProviderMetrics = {
  TotalRequestsInMyCategories: number;
  TotalRequestsMatchedToMe: number;
  TotalRequestsRespondedByMe: number;
  TotalRequestsAcceptedByMe: number;
  TotalRequestsCompletedByMe: number;
  ResponseRate: number;
  AcceptanceRate: number;
};

const EMPTY_PROVIDER_METRICS: ProviderMetrics = {
  TotalRequestsInMyCategories: 0,
  TotalRequestsMatchedToMe: 0,
  TotalRequestsRespondedByMe: 0,
  TotalRequestsAcceptedByMe: 0,
  TotalRequestsCompletedByMe: 0,
  ResponseRate: 0,
  AcceptanceRate: 0,
};

// Aggregated provider metrics straight from Supabase. All five counts run in
// parallel via head-only count queries (no row payloads transferred). Any
// individual query failure is logged and its count is coerced to 0, so one
// missing/denied table never zeroes out the whole panel.
async function getProviderMetricsFromSupabase(
  supabase: ServerSupabase,
  providerId: string,
  categories: string[]
): Promise<ProviderMetrics> {
  if (!providerId) return EMPTY_PROVIDER_METRICS;

  const categoryList = Array.from(
    new Set(
      (categories || [])
        .map((c) => String(c || "").trim())
        .filter((c) => c.length > 0)
    )
  );

  const categoriesCountPromise =
    categoryList.length > 0
      ? supabase
          .from("tasks")
          .select("task_id", { count: "exact", head: true })
          .in("category", categoryList)
      : Promise.resolve({ count: 0, error: null } as {
          count: number | null;
          error: unknown;
        });

  const matchedCountPromise = supabase
    .from("provider_task_matches")
    .select("task_id", { count: "exact", head: true })
    .eq("provider_id", providerId);

  const respondedCountPromise = supabase
    .from("provider_task_matches")
    .select("task_id", { count: "exact", head: true })
    .eq("provider_id", providerId)
    .in("match_status", ["responded", "accepted"]);

  const acceptedCountPromise = supabase
    .from("tasks")
    .select("task_id", { count: "exact", head: true })
    .eq("assigned_provider_id", providerId);

  const completedCountPromise = supabase
    .from("tasks")
    .select("task_id", { count: "exact", head: true })
    .eq("assigned_provider_id", providerId)
    .in("status", ["closed", "completed"]);

  const [
    categoriesCountResult,
    matchedCountResult,
    respondedCountResult,
    acceptedCountResult,
    completedCountResult,
  ] = await Promise.all([
    categoriesCountPromise,
    matchedCountPromise,
    respondedCountPromise,
    acceptedCountPromise,
    completedCountPromise,
  ]);

  const readCount = (
    result: { count?: number | null; error?: unknown },
    label: string
  ): number => {
    if (result?.error) {
      const msg =
        result.error instanceof Error
          ? result.error.message
          : typeof result.error === "object" && result.error && "message" in result.error
            ? String((result.error as { message?: unknown }).message || "")
            : String(result.error);
      console.warn("[provider/dashboard-profile] metric query failed", { label, error: msg });
      return 0;
    }
    return Number(result?.count || 0);
  };

  const totalRequestsInMyCategories = readCount(categoriesCountResult, "TotalRequestsInMyCategories");
  const totalRequestsMatchedToMe = readCount(matchedCountResult, "TotalRequestsMatchedToMe");
  const totalRequestsRespondedByMe = readCount(respondedCountResult, "TotalRequestsRespondedByMe");
  const totalRequestsAcceptedByMe = readCount(acceptedCountResult, "TotalRequestsAcceptedByMe");
  const totalRequestsCompletedByMe = readCount(completedCountResult, "TotalRequestsCompletedByMe");

  const responseRate =
    totalRequestsMatchedToMe > 0
      ? Math.round((totalRequestsRespondedByMe / totalRequestsMatchedToMe) * 100)
      : 0;
  const acceptanceRate =
    totalRequestsMatchedToMe > 0
      ? Math.round((totalRequestsAcceptedByMe / totalRequestsMatchedToMe) * 100)
      : 0;

  return {
    TotalRequestsInMyCategories: totalRequestsInMyCategories,
    TotalRequestsMatchedToMe: totalRequestsMatchedToMe,
    TotalRequestsRespondedByMe: totalRequestsRespondedByMe,
    TotalRequestsAcceptedByMe: totalRequestsAcceptedByMe,
    TotalRequestsCompletedByMe: totalRequestsCompletedByMe,
    ResponseRate: responseRate,
    AcceptanceRate: acceptanceRate,
  };
}

function normalizePhone10(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

function maskPhone(phone10: string): string {
  if (!phone10) return "-";
  return `******${phone10.slice(-4)}`;
}

export async function GET(request: NextRequest) {
  const cookieHeader = request.headers.get("cookie") || "";
  const cookieNames = request.cookies.getAll().map((cookie) => cookie.name);
  const session = getAuthSession({ cookie: cookieHeader });
  const rawSessionPhone = String(session?.phone || "");
  const normalizedPhone = normalizePhone10(rawSessionPhone);

  console.log("[provider/dashboard-profile] auth debug", {
    cookieNames,
    session: session
      ? {
          phoneMasked: maskPhone(normalizedPhone),
          verified: session.verified,
          createdAt: session.createdAt,
        }
      : null,
    rawSessionPhone,
    normalizedPhone,
  });

  if (!session || !normalizedPhone) {
    return NextResponse.json(
      {
        ok: false,
        error: "UNAUTHORIZED_PROVIDER_SESSION",
        message: "Provider session missing or invalid. Please log in again.",
      },
      { status: 401 }
    );
  }

  try {
    const supabase = await createClient();
    const { data: provider, error: providerError } = await supabase
      .from("providers")
      .select("*")
      .eq("phone", normalizedPhone)
      .maybeSingle();

    console.log("[provider/dashboard-profile] supabase provider response", {
      ok: !providerError,
      provider: provider
        ? {
            ProviderID: String(provider.provider_id || ""),
            Phone: String(provider.phone || ""),
          }
        : null,
      error: providerError?.message || null,
    });

    if (providerError) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_LOOKUP_REQUEST_FAILED",
          message: providerError.message || "Failed to load provider dashboard.",
        },
        { status: 500 }
      );
    }

    if (!provider) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_LOOKUP_FAILED",
          message: "Logged-in provider profile could not be found for this phone number.",
          debug: {
            normalizedPhone,
          },
        },
        { status: 404 }
      );
    }

    const matchedPhone = normalizePhone10(String(provider.phone || ""));
    if (matchedPhone !== normalizedPhone) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_PHONE_MISMATCH",
          message: "Provider lookup returned a mismatched phone number.",
          debug: {
            requestedPhone: normalizedPhone,
            matchedPhone,
            providerId: String(provider.provider_id || ""),
          },
        },
        { status: 409 }
      );
    }

    const { data: providerServices, error: servicesError } = await supabase
      .from("provider_services")
      .select("category")
      .eq("provider_id", provider.provider_id);

    if (servicesError) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_SERVICES_LOOKUP_FAILED",
          message: servicesError.message || "Failed to load provider services.",
        },
        { status: 500 }
      );
    }

    const { data: providerAreas, error: areasError } = await supabase
      .from("provider_areas")
      .select("area")
      .eq("provider_id", provider.provider_id);

    if (areasError) {
      return NextResponse.json(
        {
          ok: false,
          error: "PROVIDER_AREAS_LOOKUP_FAILED",
          message: areasError.message || "Failed to load provider areas.",
        },
        { status: 500 }
      );
    }

    const { data: matchRows, error: matchesError } = await supabase
      .from("provider_task_matches")
      .select(
        "task_id, match_status, tasks(task_id, display_id, category, area, selected_timeframe, created_at)"
      )
      .eq("provider_id", provider.provider_id)
      .limit(100);

    if (matchesError) {
      console.warn(
        "[provider/dashboard-profile] matches lookup failed",
        matchesError.message || matchesError
      );
    }

    type JoinedTask = {
      task_id?: string | number | null;
      display_id?: string | number | null;
      category?: string | null;
      area?: string | null;
      selected_timeframe?: string | null;
      created_at?: string | null;
    };
    type MatchRow = {
      task_id?: string | null;
      match_status?: string | null;
      tasks?: JoinedTask | JoinedTask[] | null;
    };

    const providerCategoryList = Array.isArray(providerServices)
      ? providerServices
          .map((item) => String(item.category || "").trim())
          .filter((c) => c.length > 0)
      : [];

    let metrics: ProviderMetrics = EMPTY_PROVIDER_METRICS;
    try {
      metrics = await getProviderMetricsFromSupabase(
        supabase,
        String(provider.provider_id || ""),
        providerCategoryList
      );
    } catch (metricsError) {
      console.warn(
        "[provider/dashboard-profile] metrics compute failed",
        metricsError instanceof Error ? metricsError.message : metricsError
      );
    }

    const safeMatches: MatchRow[] = Array.isArray(matchRows) ? (matchRows as MatchRow[]) : [];
    const recentMatchedRequests = safeMatches
      .map((row) => {
        const joined = Array.isArray(row?.tasks) ? row.tasks[0] : row?.tasks;
        if (!joined) return null;
        const status = String(row?.match_status || "").trim().toLowerCase();
        return {
          TaskID: String(joined.task_id ?? row?.task_id ?? "").trim(),
          DisplayID:
            joined.display_id !== null && joined.display_id !== undefined
              ? String(joined.display_id)
              : "",
          Category: String(joined.category || ""),
          Area: String(joined.area || ""),
          Details: "",
          CreatedAt: String(joined.created_at || ""),
          Accepted: status === "accepted",
          Responded: status === "responded" || status === "accepted",
          ThreadID: "",
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null && Boolean(item.TaskID))
      .sort((a, b) => {
        const ta = Date.parse(a.CreatedAt || "") || 0;
        const tb = Date.parse(b.CreatedAt || "") || 0;
        return tb - ta;
      })
      .slice(0, 20);

    return NextResponse.json({
      ok: true,
      provider: {
        ProviderID: String(provider.provider_id || ""),
        ProviderName: String(provider.full_name || ""),
        Phone: String(provider.phone || ""),
        Verified: String(provider.verified || ""),
        OtpVerified: "yes",
        OtpVerifiedAt: new Date(session.createdAt).toISOString(),
        LastLoginAt: String(provider.created_at || ""),
        PendingApproval: String(provider.status || "").trim().toLowerCase() === "pending" ? "yes" : "no",
        Status: String(provider.status || ""),
        DuplicateNameReviewStatus: String(provider.duplicate_name_review_status || ""),
        Services: Array.isArray(providerServices)
          ? providerServices.map((item) => ({
              Category: String(item.category || ""),
            }))
          : [],
        Areas: Array.isArray(providerAreas)
          ? providerAreas.map((item) => ({
              Area: String(item.area || ""),
            }))
          : [],
        AreaCoverage: null,
        Analytics: {
          RecentMatchedRequests: recentMatchedRequests,
          Metrics: metrics,
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: "PROVIDER_LOOKUP_REQUEST_FAILED",
        message: error?.message || "Failed to load provider dashboard.",
      },
      { status: 500 }
    );
  }
}
