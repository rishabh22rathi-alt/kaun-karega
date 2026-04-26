import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { adminSupabase } from "@/lib/supabase/admin";

function normalizePhone10(value: string): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

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

    const normalizedPhone = normalizePhone10(session.phone);
    const supabase = await createClient();
    const { data: tasks, error } = await supabase
      .from("tasks")
      .select("task_id, display_id, category, area, details, status, created_at")
      .eq("phone", normalizedPhone)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message || "Failed to load requests" },
        { status: 500 }
      );
    }

    // Batch-fetch provider_task_matches for the user's tasks plus the
    // provider rows for every matched provider_id. The Responses page reads
    // `MatchedProviders.length` for the count and `.map(...)` over the
    // MatchedProviderDetails array — both consume per-task data. Two
    // round-trips total, bounded by the user's own task count.
    const taskIds = (tasks || [])
      .map((t) => String(t.task_id || ""))
      .filter(Boolean);
    const matchesByTaskId = new Map<string, string[]>();
    const matchStatusByKey = new Map<string, string>();
    const allProviderIds = new Set<string>();
    if (taskIds.length > 0) {
      const { data: matchRows } = await supabase
        .from("provider_task_matches")
        .select("task_id, provider_id, match_status")
        .in("task_id", taskIds);
      for (const row of matchRows || []) {
        const id = String(row.task_id || "");
        const pid = String(row.provider_id || "").trim();
        if (!id || !pid) continue;
        const arr = matchesByTaskId.get(id) || [];
        arr.push(pid);
        matchesByTaskId.set(id, arr);
        matchStatusByKey.set(`${id}|${pid}`, String(row.match_status || "").trim());
        allProviderIds.add(pid);
      }
    }

    type ProviderDetail = {
      ProviderID: string;
      ProviderName: string;
      ProviderPhone: string;
      Verified: string;
      // OtpVerified / OtpVerifiedAt are populated from profiles.last_login_at
      // — the timestamp written by /api/verify-otp (and /api/auth/verify-otp)
      // on every successful OTP verification. This is the same source of
      // truth used implicitly by the dashboard's session.createdAt path for
      // the logged-in viewer. The shared isProviderVerifiedBadge in
      // lib/providerPresentation.ts then enforces the 30-day window.
      OtpVerified: string;
      OtpVerifiedAt: string;
      PendingApproval: string;
      Status: string;
      DuplicateNameReviewStatus: string;
    };
    const providersById = new Map<string, ProviderDetail>();
    const providerPhone10ByPid = new Map<string, string>();
    if (allProviderIds.size > 0) {
      const { data: providerRows } = await supabase
        .from("providers")
        .select(
          "provider_id, full_name, phone, verified, status, duplicate_name_review_status"
        )
        .in("provider_id", Array.from(allProviderIds));
      for (const row of providerRows || []) {
        const pid = String(row.provider_id || "").trim();
        if (!pid) continue;
        const status = String(row.status || "").trim();
        const phoneRaw = String(row.phone || "").trim();
        const phone10 = phoneRaw.replace(/\D/g, "").slice(-10);
        if (phone10) providerPhone10ByPid.set(pid, phone10);
        providersById.set(pid, {
          ProviderID: pid,
          ProviderName: String(row.full_name || "").trim(),
          ProviderPhone: phoneRaw,
          Verified: String(row.verified || "no").trim() || "no",
          // OTP fields are filled in below once profiles are fetched.
          OtpVerified: "no",
          OtpVerifiedAt: "",
          PendingApproval: status.toLowerCase() === "pending" ? "yes" : "no",
          Status: status,
          DuplicateNameReviewStatus: String(row.duplicate_name_review_status || "").trim(),
        });
      }
    }

    // Batch-fetch profiles.last_login_at for the union of provider phones.
    // profiles.phone is stored in BOTH "9XXXXXXXXX" (10-digit) and
    // "919XXXXXXXXX" (12-digit) variants depending on which OTP-verify route
    // wrote it; query both forms and reduce by phone.slice(-10), keeping the
    // most recent timestamp if the same phone has multiple rows.
    const profileLoginByPhone10 = new Map<string, string>();
    const allPhone10s = new Set(providerPhone10ByPid.values());
    if (allPhone10s.size > 0) {
      const phoneList = Array.from(allPhone10s).flatMap((p) => [p, `91${p}`]);
      // Use service-role client: profiles is RLS-protected so the user's
      // anon client only sees its own row. The fields read (phone +
      // last_login_at) are not sensitive — phone is already returned in
      // ProviderPhone, and the timestamp only feeds the 30-day OTP gate.
      const { data: profileRows } = await adminSupabase
        .from("profiles")
        .select("phone, last_login_at")
        .in("phone", phoneList);
      for (const row of profileRows || []) {
        const last = String(row.last_login_at || "").trim();
        if (!last) continue;
        const p10 = String(row.phone || "").replace(/\D/g, "").slice(-10);
        if (!p10) continue;
        const existing = profileLoginByPhone10.get(p10);
        if (!existing || last > existing) {
          profileLoginByPhone10.set(p10, last);
        }
      }
    }

    for (const [pid, detail] of providersById.entries()) {
      const phone10 = providerPhone10ByPid.get(pid) || "";
      const lastLogin = phone10 ? profileLoginByPhone10.get(phone10) || "" : "";
      detail.OtpVerified = lastLogin ? "yes" : "no";
      detail.OtpVerifiedAt = lastLogin;
    }

    return NextResponse.json({
      ok: true,
      requests: Array.isArray(tasks)
        ? tasks.map((task) => ({
            TaskID: String(task.task_id || "").trim(),
            DisplayID:
              typeof task.display_id === "string" || typeof task.display_id === "number"
                ? String(task.display_id).trim()
                : "",
            Category: String(task.category || "").trim(),
            Area: String(task.area || "").trim(),
            Details: String(task.details || "").trim(),
            Status: String(task.status || "").trim(),
            CreatedAt: String(task.created_at || "").trim(),
            MatchedProviders: matchesByTaskId.get(String(task.task_id || "")) || [],
            MatchedProviderDetails: (
              matchesByTaskId.get(String(task.task_id || "")) || []
            )
              .map((pid) => {
                const detail = providersById.get(pid);
                if (!detail) return null;
                return {
                  ...detail,
                  ResponseStatus:
                    matchStatusByKey.get(`${String(task.task_id || "")}|${pid}`) || "",
                };
              })
              .filter((row): row is ProviderDetail & { ResponseStatus: string } =>
                Boolean(row)
              ),
            RespondedProvider: "",
            RespondedProviderName: "",
          }))
        : [],
    });
  } catch (error: any) {
    console.error("My requests error:", error);
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }
}
