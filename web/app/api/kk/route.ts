import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { createClient } from "@/lib/supabase/server";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  setProviderVerified,
  approveDuplicateNameReview,
  markDuplicateNameLegitSeparate,
  rejectDuplicateNameProvider,
  keepDuplicateNameUnderReview,
} from "@/lib/admin/adminProviderMutations";
import {
  getProviderByPhoneFromSupabase,
  listDuplicateNameReviews,
} from "@/lib/admin/adminProviderReads";
import { findDuplicateNameProviders } from "@/lib/providerNameNormalize";
import {
  getAdminNotificationLogsFromSupabase,
  getAdminNotificationSummaryFromSupabase,
} from "@/lib/admin/adminNotificationReads";
import {
  getIssueReportsFromSupabase,
  updateIssueReportStatusFromSupabase,
} from "@/lib/admin/adminIssueReports";
import {
  getAreaMappingsFromSupabase,
  addAreaToSupabase,
  editAreaInSupabase,
  addAreaAliasToSupabase,
  mergeAreaIntoCanonicalInSupabase,
  updateAreaAliasInSupabase,
  toggleAreaAliasInSupabase,
  canonicalizeProviderAreasToCanonicalNames,
  listActiveCanonicalAreas,
} from "@/lib/admin/adminAreaMappings";
import {
  getUnmappedAreasFromSupabase,
  mapUnmappedAreaInSupabase,
  createAreaFromUnmappedInSupabase,
  resolveUnmappedAreaInSupabase,
  queueUnmappedAreaForReview,
} from "@/lib/admin/adminUnmappedAreas";
import { remindProvidersForTask } from "@/lib/admin/adminReminderMutations";
import { getAdminRequestsFromSupabase } from "@/lib/admin/adminTaskReads";
import { assignProviderToTask, closeTask } from "@/lib/admin/adminTaskMutations";
import {
  approveCategoryRequest,
  rejectCategoryRequest,
  closeCategoryRequest,
  archiveCategoryRequest,
  softDeleteCategoryRequest,
  addCategory,
  editCategory,
  toggleCategory,
} from "@/lib/admin/adminCategoryMutations";
import {
  createOrGetChatThreadFromSupabase,
  getAdminChatThreadFromSupabase,
  getAdminChatThreadsFromSupabase,
  getChatMessagesFromSupabase,
  getChatThreadsFromSupabase,
  markChatReadFromSupabase,
  sendChatMessageFromSupabase,
  updateChatThreadStatusFromSupabase,
  getNeedChatMessagesFromSupabase,
  getNeedChatThreadsForNeedFromSupabase,
  markNeedChatReadFromSupabase,
  sendNeedChatMessageFromSupabase,
  createOrGetNeedChatThreadFromSupabase,
} from "@/lib/chat/chatPersistence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Actions that are admin-only and require a valid admin session.
 *
 * Excludes "get_admin_requests" — it is also used by the provider chat page
 * (app/chat/[taskId]/page.tsx) to look up task details, so it must remain open.
 *
 * Non-admin actions (chat_*, need_chat_*, get_needs, get_provider_by_phone,
 * provider_register, etc.) are not listed here and pass through without checks.
 */
const ADMIN_ONLY_ACTIONS = new Set([
  // Admin dashboard — reads
  "admin_get_dashboard",
  "admin_get_providers",
  "admin_get_provider",
  "admin_get_category_requests",
  "admin_get_categories",
  "admin_get_area_mappings",
  "admin_get_unmapped_areas",
  "admin_get_requests",
  "admin_get_notification_logs",
  "admin_get_notification_summary",
  "admin_get_team_members",
  "admin_get_issue_reports",
  "admin_notification_summary",
  "get_admin_area_mappings",
  "admin_notification_logs",
  // Admin dashboard — writes
  "admin_verify_provider",
  "admin_approve_category",
  "admin_reject_category",
  "admin_close_category_request",
  "admin_archive_category_request",
  "admin_delete_category_request_soft",
  "admin_add_category",
  "admin_edit_category",
  "admin_toggle_category",
  "admin_add_area",
  "admin_edit_area",
  "admin_add_area_alias",
  "admin_update_area_alias",
  "admin_toggle_area_alias",
  "admin_merge_area_into_canonical",
  "admin_map_unmapped_area",
  "admin_create_area_from_unmapped",
  "admin_resolve_unmapped_area",
  "admin_remind_providers",
  "admin_assign_provider",
  "admin_close_request",
  "admin_update_provider",
  "admin_set_provider_blocked",
  "admin_list_duplicate_name_reviews",
  "admin_duplicate_name_review_approve",
  "admin_duplicate_name_review_mark_separate",
  "admin_duplicate_name_review_reject",
  "admin_duplicate_name_review_keep",
  "admin_add_team_member",
  "admin_update_team_member",
  "admin_delete_team_member",
  "admin_update_issue_report_status",
  "set_provider_verified",
  "add_category",
  "edit_category",
  "toggle_category",
  "add_area",
  "edit_area",
  "add_area_alias",
  "merge_area_into_canonical",
  "remind_providers",
  "assign_provider",
  "close_request",
  "approve_category_request",
  "reject_category_request",
  // Admin chat management
  "get_admin_chat_threads",
  "close_chat_thread",
  "get_chat_messages",
  "admin_list_chat_threads",
  "admin_get_chat_thread",
  "admin_update_chat_thread_status",
  // Admin needs management
  "admin_get_needs",
  "admin_close_need",
  "admin_hide_need",
  "admin_unhide_need",
  "admin_set_need_rank",
]);

function extractAction(source: unknown): string {
  if (source && typeof source === "object" && !Array.isArray(source)) {
    const val = (source as Record<string, unknown>).action;
    if (typeof val === "string") return val.trim();
  }
  return "";
}

const STANDARDIZED_ADMIN_ACTIONS = new Set([...ADMIN_ONLY_ACTIONS, "admin_verify", "get_admin_requests"]);

function parseArrayLike(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function normalizeProxyBody(rawBody: unknown): Record<string, unknown> {
  const body =
    rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
      ? ({ ...rawBody } as Record<string, unknown>)
      : {};

  body.categories = parseArrayLike(body.categories);
  body.areas = parseArrayLike(body.areas);
  if ("pendingNewCategories" in body) {
    body.pendingNewCategories = parseArrayLike(body.pendingNewCategories);
  }
  return body;
}

function withNoCache(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

function formatChatTimestamp(value: string | null | undefined): string {
  const parsed = value ? new Date(value) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(parsed);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.day || "01"}/${lookup.month || "01"}/${lookup.year || "1970"} ${lookup.hour || "00"}:${lookup.minute || "00"}:${lookup.second || "00"}`;
}

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

function normalizeNeedBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function normalizeNeedValidDays(value: unknown): number {
  const days = Number(value) || 0;
  return days === 3 || days === 7 || days === 15 || days === 30 ? days : 3;
}

function getNeedCurrentStatus(status: string | null | undefined, expiresAt: string | null | undefined, isHidden: boolean): string {
  if (isHidden) return "hidden";

  const normalizedStatus = String(status || "").trim().toLowerCase() || "open";
  if (normalizedStatus === "open") {
    const expiresMs = expiresAt ? new Date(expiresAt).getTime() : NaN;
    if (!Number.isNaN(expiresMs) && expiresMs <= Date.now()) {
      return "expired";
    }
  }

  return normalizedStatus;
}

function normalizeAdminPayload(
  action: string,
  payload: unknown
): Record<string, unknown> | undefined {
  if (!STANDARDIZED_ADMIN_ACTIONS.has(action)) return undefined;

  const source =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? ({ ...(payload as Record<string, unknown>) } as Record<string, unknown>)
      : {};
  const ok = source.ok === true;
  const error = ok ? null : typeof source.error === "string" ? source.error : "Admin request failed";
  return {
    ...source,
    ok,
    data: ok ? source : null,
    error,
  };
}

export async function GET(request: NextRequest) {
  try {
    const action = request.nextUrl.searchParams.get("action") ?? "";
    if (ADMIN_ONLY_ACTIONS.has(action)) {
      const auth = await requireAdminSession(request);
      if (!auth.ok) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
        );
      }
    }
    if (action === "get_provider_by_phone") {
      const phone = request.nextUrl.searchParams.get("phone") ?? "";
      const result = await getProviderByPhoneFromSupabase(phone);
      return withNoCache(NextResponse.json(result));
    }
    if (action === "get_areas") {
      const reconcileResult = await canonicalizeProviderAreasToCanonicalNames();
      if (!reconcileResult.ok) {
        return withNoCache(
          NextResponse.json(
            { ok: false, status: "error", error: reconcileResult.error },
            { status: 500 }
          )
        );
      }

      const areas = await listActiveCanonicalAreas();
      return withNoCache(
        NextResponse.json({ ok: true, status: "success", areas }, { status: 200 })
      );
    }
    // Fail closed: any GET action that did not match a native intercept
    // above is not supported. The legacy Apps Script GET fallthrough has
    // been removed.
    return withNoCache(
      NextResponse.json(
        {
          ok: false,
          error: "Unsupported action",
          action,
        },
        { status: 400 }
      )
    );
  } catch (error: any) {
    return withNoCache(
      NextResponse.json(
        {
          ok: false,
          error: "KK_PROXY_GET_FAILED",
          message: error?.message || "Failed to proxy GET request",
        },
        { status: 500 }
      )
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.json();
    const action = extractAction(rawBody);
    if (ADMIN_ONLY_ACTIONS.has(action)) {
      const auth = await requireAdminSession(request);
      if (!auth.ok) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 })
        );
      }
    }
    const body = normalizeProxyBody(rawBody);
    if (action === "get_areas") {
      const reconcileResult = await canonicalizeProviderAreasToCanonicalNames();
      if (!reconcileResult.ok) {
        return withNoCache(
          NextResponse.json(
            { ok: false, status: "error", error: reconcileResult.error },
            { status: 500 }
          )
        );
      }

      const areas = await listActiveCanonicalAreas();
      return withNoCache(
        NextResponse.json({ ok: true, status: "success", areas }, { status: 200 })
      );
    }
    if (action === "get_admin_requests" || action === "admin_get_requests") {
      const result = await getAdminRequestsFromSupabase();
      const normalized = normalizeAdminPayload(action, result) ?? result;
      return withNoCache(
        NextResponse.json(normalized, { status: result.ok ? 200 : 500 })
      );
    }
    if (action === "admin_notification_logs" || action === "admin_get_notification_logs") {
      const limit =
        typeof body.limit === "number"
          ? body.limit
          : typeof body.limit === "string"
            ? Number(body.limit)
            : 20;
      const result = await getAdminNotificationLogsFromSupabase(limit);
      const normalized = normalizeAdminPayload(action, result) ?? result;
      return withNoCache(
        NextResponse.json(normalized, { status: result.ok ? 200 : 500 })
      );
    }
    if (action === "admin_notification_summary" || action === "admin_get_notification_summary") {
      const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
      const result = await getAdminNotificationSummaryFromSupabase(taskId);
      const normalized = normalizeAdminPayload(action, result) ?? result;
      return withNoCache(
        NextResponse.json(normalized, { status: result.ok ? 200 : 500 })
      );
    }
    if (action === "admin_get_issue_reports") {
      const result = await getIssueReportsFromSupabase();
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 500 }));
    }
    if (action === "admin_update_issue_report_status") {
      const result = await updateIssueReportStatusFromSupabase(body);
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 500 }));
    }
    if (action === "add_area" || action === "admin_add_area") {
      const areaName = typeof body.areaName === "string" ? body.areaName.trim() : "";
      if (!areaName) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "areaName required" }, { status: 400 })
        );
      }
      const result = await addAreaToSupabase({ areaName });
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 400 }));
    }
    if (action === "edit_area" || action === "admin_edit_area") {
      const oldArea = typeof body.oldArea === "string" ? body.oldArea.trim() : "";
      const newArea = typeof body.newArea === "string" ? body.newArea.trim() : "";
      if (!oldArea || !newArea) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "oldArea and newArea required" }, { status: 400 })
        );
      }
      const result = await editAreaInSupabase({ oldArea, newArea });
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 400 }));
    }
    if (action === "get_admin_area_mappings" || action === "admin_get_area_mappings") {
      const result = await getAreaMappingsFromSupabase();
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 500 }));
    }
    if (action === "add_area_alias" || action === "admin_add_area_alias") {
      const aliasName = typeof body.aliasName === "string" ? body.aliasName.trim() : "";
      const canonicalArea = typeof body.canonicalArea === "string" ? body.canonicalArea.trim() : "";
      if (!aliasName || !canonicalArea) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "aliasName and canonicalArea required" }, { status: 400 })
        );
      }
      const result = await addAreaAliasToSupabase({ aliasName, canonicalArea });
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 400 }));
    }
    if (action === "merge_area_into_canonical" || action === "admin_merge_area_into_canonical") {
      const sourceArea = typeof body.sourceArea === "string" ? body.sourceArea.trim() : "";
      const canonicalArea = typeof body.canonicalArea === "string" ? body.canonicalArea.trim() : "";
      if (!sourceArea || !canonicalArea) {
        return withNoCache(
          NextResponse.json(
            { ok: false, error: "sourceArea and canonicalArea required" },
            { status: 400 }
          )
        );
      }
      const result = await mergeAreaIntoCanonicalInSupabase({ sourceArea, canonicalArea });
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 400 }));
    }
    if (action === "admin_update_area_alias") {
      const oldAliasName = typeof body.oldAliasName === "string" ? body.oldAliasName.trim() : "";
      const newAliasName = typeof body.newAliasName === "string" ? body.newAliasName.trim() : "";
      const canonicalArea = typeof body.canonicalArea === "string" ? body.canonicalArea.trim() : "";
      if (!oldAliasName || !newAliasName || !canonicalArea) {
        return withNoCache(
          NextResponse.json(
            { ok: false, error: "oldAliasName, newAliasName, and canonicalArea required" },
            { status: 400 }
          )
        );
      }
      const result = await updateAreaAliasInSupabase({ oldAliasName, newAliasName, canonicalArea });
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 400 }));
    }
    if (action === "admin_toggle_area_alias") {
      const aliasName = typeof body.aliasName === "string" ? body.aliasName.trim() : "";
      const active = typeof body.active === "string" ? body.active.trim() : "";
      if (!aliasName || !active) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "aliasName and active required" }, { status: 400 })
        );
      }
      const result = await toggleAreaAliasInSupabase({ aliasName, active });
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 400 }));
    }
    if (action === "admin_get_unmapped_areas") {
      const result = await getUnmappedAreasFromSupabase();
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 500 }));
    }
    if (action === "admin_map_unmapped_area") {
      const reviewId = typeof body.reviewId === "string" ? body.reviewId.trim() : "";
      const rawArea = typeof body.rawArea === "string" ? body.rawArea.trim() : "";
      const canonicalArea = typeof body.canonicalArea === "string" ? body.canonicalArea.trim() : "";
      if (!reviewId || !rawArea || !canonicalArea) {
        return withNoCache(
          NextResponse.json(
            { ok: false, error: "reviewId, rawArea, and canonicalArea required" },
            { status: 400 }
          )
        );
      }
      const result = await mapUnmappedAreaInSupabase({ reviewId, rawArea, canonicalArea });
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 400 }));
    }
    if (action === "admin_create_area_from_unmapped") {
      const reviewId = typeof body.reviewId === "string" ? body.reviewId.trim() : "";
      const rawArea = typeof body.rawArea === "string" ? body.rawArea.trim() : "";
      if (!reviewId || !rawArea) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "reviewId and rawArea required" }, { status: 400 })
        );
      }
      const canonicalArea =
        typeof body.canonicalArea === "string" ? body.canonicalArea.trim() : undefined;
      const result = await createAreaFromUnmappedInSupabase({ reviewId, rawArea, canonicalArea });
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 400 }));
    }
    if (action === "admin_resolve_unmapped_area") {
      const reviewId = typeof body.reviewId === "string" ? body.reviewId.trim() : "";
      if (!reviewId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "reviewId required" }, { status: 400 })
        );
      }
      const resolvedCanonicalArea =
        typeof body.resolvedCanonicalArea === "string" ? body.resolvedCanonicalArea.trim() : "";
      const result = await resolveUnmappedAreaInSupabase({ reviewId, resolvedCanonicalArea });
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 400 }));
    }
    if (action === "admin_get_needs") {
      const statusFilter = typeof body.Status === "string" ? body.Status.trim().toLowerCase() : "all";
      const categoryFilter = typeof body.Category === "string" ? body.Category.trim().toLowerCase() : "";
      const areaFilter = typeof body.Area === "string" ? body.Area.trim().toLowerCase() : "";
      const searchFilter = typeof body.Search === "string" ? body.Search.trim().toLowerCase() : "";

      const supabase = await createClient();
      const { data, error } = await supabase
        .from("needs")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) {
        return withNoCache(
          NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        );
      }

      return withNoCache(
        NextResponse.json({
          ok: true,
          needs: (data ?? [])
            .filter((need) => {
              const isHidden = need.is_hidden === true;
              const derivedStatus = getNeedCurrentStatus(need.status, need.expires_at, isHidden);
              const needCategory = String(need.category || "").trim().toLowerCase();
              const needAreas = String(need.area || "")
                .split(",")
                .map((a) => a.trim().toLowerCase())
                .filter(Boolean);
              const searchHaystack = [
                String(need.need_id || "").trim(),
                String(need.title || "").trim(),
                String(need.description || "").trim(),
                String(need.user_phone || "").trim(),
                String(need.display_name || "").trim(),
              ]
                .join(" ")
                .toLowerCase();

              if (statusFilter && statusFilter !== "all") {
                if (statusFilter === "hidden") {
                  if (!isHidden) return false;
                } else if (statusFilter === "active") {
                  if (isHidden || (derivedStatus !== "open" && derivedStatus !== "active")) {
                    return false;
                  }
                } else if (derivedStatus !== statusFilter) {
                  return false;
                }
              }
              if (categoryFilter && needCategory !== categoryFilter) {
                return false;
              }
              if (areaFilter && !needAreas.includes(areaFilter)) {
                return false;
              }
              if (searchFilter && !searchHaystack.includes(searchFilter)) {
                return false;
              }
              return true;
            })
            .map((need) => {
              const isAnonymous = need.is_anonymous === true;
              const displayName = String(need.display_name || "");
              const status = String(need.status || "");
              const isHidden = need.is_hidden === true;
              return {
                NeedID: need.need_id,
                UserPhone: need.user_phone,
                DisplayName: displayName,
                IsAnonymous: isAnonymous,
                PosterLabel: isAnonymous ? "Anonymous" : displayName,
                Category: need.category,
                Area: need.area,
                Title: need.title,
                Description: need.description,
                Status: status,
                CurrentStatus: getNeedCurrentStatus(status, need.expires_at, isHidden),
                ViewsCount: need.views_count,
                ResponsesCount: need.responses_count,
                CreatedAt: formatChatTimestamp(need.created_at),
                UpdatedAt: formatChatTimestamp(need.updated_at),
                ValidDays: need.valid_days,
                ExpiresAt: formatChatTimestamp(need.expires_at),
                CompletedAt: formatChatTimestamp(need.completed_at),
                ClosedAt: formatChatTimestamp(need.closed_at),
                ClosedBy: need.closed_by,
                AdminNote: need.admin_note,
                PriorityRank: need.priority_rank,
                IsHidden: isHidden,
              };
          }),
        })
      );
    }
    if (action === "admin_hide_need") {
      const needId = typeof body.NeedID === "string" ? body.NeedID.trim() : "";

      if (!needId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "NeedID required" }, { status: 400 })
        );
      }

      const supabase = await createClient();
      const { data: need, error: needError } = await supabase
        .from("needs")
        .select("need_id")
        .eq("need_id", needId)
        .maybeSingle();

      if (needError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: needError.message }, { status: 500 })
        );
      }
      if (!need) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Need not found" }, { status: 404 })
        );
      }

      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("needs")
        .update({
          is_hidden: true,
          closed_by: "admin",
          updated_at: nowIso,
        })
        .eq("need_id", needId);

      if (updateError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
        );
      }

      return withNoCache(
        NextResponse.json({
          ok: true,
          status: "success",
          NeedID: needId,
          message: "Need hidden",
        })
      );
    }
    if (action === "admin_unhide_need") {
      const needId = typeof body.NeedID === "string" ? body.NeedID.trim() : "";

      if (!needId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "NeedID required" }, { status: 400 })
        );
      }

      const supabase = await createClient();
      const { data: need, error: needError } = await supabase
        .from("needs")
        .select("need_id")
        .eq("need_id", needId)
        .maybeSingle();

      if (needError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: needError.message }, { status: 500 })
        );
      }
      if (!need) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Need not found" }, { status: 404 })
        );
      }

      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("needs")
        .update({
          is_hidden: false,
          updated_at: nowIso,
        })
        .eq("need_id", needId);

      if (updateError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
        );
      }

      return withNoCache(
        NextResponse.json({
          ok: true,
          status: "success",
          NeedID: needId,
          message: "Need unhidden",
        })
      );
    }
    if (action === "admin_close_need") {
      const needId = typeof body.NeedID === "string" ? body.NeedID.trim() : "";

      if (!needId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "NeedID required" }, { status: 400 })
        );
      }

      const supabase = await createClient();
      const { data: need, error: needError } = await supabase
        .from("needs")
        .select("need_id")
        .eq("need_id", needId)
        .maybeSingle();

      if (needError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: needError.message }, { status: 500 })
        );
      }
      if (!need) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Need not found" }, { status: 404 })
        );
      }

      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("needs")
        .update({
          status: "closed",
          closed_by: "admin",
          closed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("need_id", needId);

      if (updateError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
        );
      }

      return withNoCache(
        NextResponse.json({
          ok: true,
          status: "success",
          NeedID: needId,
          message: "Need closed",
        })
      );
    }
    if (action === "admin_set_need_rank") {
      const needId = typeof body.NeedID === "string" ? body.NeedID.trim() : "";
      const rawRank = body.PriorityRank;
      const rank = typeof rawRank === "number" ? rawRank : typeof rawRank === "string" ? Number(rawRank) : NaN;

      if (!needId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "NeedID required" }, { status: 400 })
        );
      }
      if (!Number.isInteger(rank) || rank < 0) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "PriorityRank must be a non-negative integer" }, { status: 400 })
        );
      }

      const supabase = await createClient();
      const { data: need, error: needError } = await supabase
        .from("needs")
        .select("need_id")
        .eq("need_id", needId)
        .maybeSingle();

      if (needError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: needError.message }, { status: 500 })
        );
      }
      if (!need) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Need not found" }, { status: 404 })
        );
      }

      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("needs")
        .update({
          priority_rank: rank,
          updated_at: nowIso,
        })
        .eq("need_id", needId);

      if (updateError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
        );
      }

      return withNoCache(
        NextResponse.json({
          ok: true,
          status: "success",
          NeedID: needId,
          message: "Need rank updated",
        })
      );
    }
    if (action === "remind_providers" || action === "admin_remind_providers") {
      const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
      if (!taskId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Missing required field: taskId" }, { status: 400 })
        );
      }
      const result = await remindProvidersForTask(taskId);
      const normalized = normalizeAdminPayload(action, result) ?? result;
      return withNoCache(
        NextResponse.json(normalized, { status: result.ok ? 200 : 500 })
      );
    }
    if (action === "set_provider_verified") {
      const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
      const verified = body.verified === "yes" || body.verified === "no" ? body.verified : null;
      if (!providerId || !verified) {
        return withNoCache(
          NextResponse.json(
            { ok: false, error: "Missing required fields: providerId, verified" },
            { status: 400 }
          )
        );
      }
      const result = await setProviderVerified(providerId, verified);
      if (!result.ok) {
        return withNoCache(
          NextResponse.json({ ok: false, error: result.error }, { status: 500 })
        );
      }
      return withNoCache(NextResponse.json({ ok: true }));
    }
    if (action === "admin_list_duplicate_name_reviews") {
      const rows = await listDuplicateNameReviews();
      return withNoCache(NextResponse.json({ ok: true, rows }));
    }
    if (
      action === "admin_duplicate_name_review_approve" ||
      action === "admin_duplicate_name_review_mark_separate" ||
      action === "admin_duplicate_name_review_reject" ||
      action === "admin_duplicate_name_review_keep"
    ) {
      const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
      const adminActorPhone =
        typeof body.AdminActorPhone === "string" ? body.AdminActorPhone.trim() : "";
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      if (!providerId) {
        return withNoCache(
          NextResponse.json(
            { ok: false, error: "Missing required field: providerId" },
            { status: 400 }
          )
        );
      }
      if (action === "admin_duplicate_name_review_reject" && !reason) {
        return withNoCache(
          NextResponse.json(
            { ok: false, error: "Reason required for rejection" },
            { status: 400 }
          )
        );
      }
      const ctx = { adminActorPhone, reason };
      const result =
        action === "admin_duplicate_name_review_approve"
          ? await approveDuplicateNameReview(providerId, ctx)
          : action === "admin_duplicate_name_review_mark_separate"
            ? await markDuplicateNameLegitSeparate(providerId, ctx)
            : action === "admin_duplicate_name_review_reject"
              ? await rejectDuplicateNameProvider(providerId, ctx)
              : await keepDuplicateNameUnderReview(providerId, ctx);
      if (!result.ok) {
        return withNoCache(
          NextResponse.json({ ok: false, error: result.error }, { status: 500 })
        );
      }
      return withNoCache(NextResponse.json({ ok: true }));
    }
    if (action === "approve_category_request") {
      const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
      const categoryName = typeof body.categoryName === "string" ? body.categoryName.trim() : "";
      const adminActorName = typeof body.AdminActorName === "string" ? body.AdminActorName.trim() : "";
      const adminActorPhone = typeof body.AdminActorPhone === "string" ? body.AdminActorPhone.trim() : "";
      const adminActionReason = typeof body.adminActionReason === "string" ? body.adminActionReason.trim() : "";
      if (!requestId || !categoryName) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Missing required fields: requestId, categoryName" }, { status: 400 })
        );
      }
      const result = await approveCategoryRequest(requestId, categoryName, adminActorName, adminActorPhone, adminActionReason);
      if (!result.ok) {
        return withNoCache(NextResponse.json({ ok: false, error: result.error }, { status: 500 }));
      }
      return withNoCache(NextResponse.json({ ok: true }));
    }
    if (
      action === "reject_category_request" ||
      action === "admin_close_category_request" ||
      action === "admin_archive_category_request" ||
      action === "admin_delete_category_request_soft"
    ) {
      const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      const adminActorName = typeof body.AdminActorName === "string" ? body.AdminActorName.trim() : "";
      const adminActorPhone = typeof body.AdminActorPhone === "string" ? body.AdminActorPhone.trim() : "";
      if (!requestId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Missing required field: requestId" }, { status: 400 })
        );
      }
      const mutationFn =
        action === "reject_category_request" ? rejectCategoryRequest :
        action === "admin_close_category_request" ? closeCategoryRequest :
        action === "admin_archive_category_request" ? archiveCategoryRequest :
        softDeleteCategoryRequest;
      const result = await mutationFn(requestId, reason, adminActorName, adminActorPhone);
      if (!result.ok) {
        return withNoCache(NextResponse.json({ ok: false, error: result.error }, { status: 500 }));
      }
      return withNoCache(NextResponse.json({ ok: true }));
    }
    if (action === "add_category") {
      const categoryName = typeof body.categoryName === "string" ? body.categoryName.trim() : "";
      if (!categoryName) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Missing required field: categoryName" }, { status: 400 })
        );
      }
      const result = await addCategory(categoryName);
      if (!result.ok) {
        return withNoCache(NextResponse.json({ ok: false, error: result.error }, { status: 500 }));
      }
      return withNoCache(NextResponse.json({ ok: true }));
    }
    if (action === "edit_category") {
      const oldName = typeof body.oldName === "string" ? body.oldName.trim() : "";
      const newName = typeof body.newName === "string" ? body.newName.trim() : "";
      if (!oldName || !newName) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Missing required fields: oldName, newName" }, { status: 400 })
        );
      }
      const result = await editCategory(oldName, newName);
      if (!result.ok) {
        return withNoCache(NextResponse.json({ ok: false, error: result.error }, { status: 500 }));
      }
      return withNoCache(NextResponse.json({ ok: true }));
    }
    if (action === "toggle_category") {
      const categoryName = typeof body.categoryName === "string" ? body.categoryName.trim() : "";
      const active = body.active === "yes" || body.active === "no" ? body.active : null;
      if (!categoryName || !active) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Missing required fields: categoryName, active" }, { status: 400 })
        );
      }
      const result = await toggleCategory(categoryName, active);
      if (!result.ok) {
        return withNoCache(NextResponse.json({ ok: false, error: result.error }, { status: 500 }));
      }
      return withNoCache(NextResponse.json({ ok: true }));
    }
    if (action === "assign_provider") {
      const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
      const providerId = typeof body.providerId === "string" ? body.providerId.trim() : "";
      if (!taskId || !providerId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Missing required fields: taskId, providerId" }, { status: 400 })
        );
      }
      const result = await assignProviderToTask(taskId, providerId);
      if (!result.ok) {
        return withNoCache(NextResponse.json({ ok: false, error: result.error }, { status: 500 }));
      }
      return withNoCache(NextResponse.json({ ok: true }));
    }
    if (action === "close_request" || action === "admin_close_request") {
      const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
      if (!taskId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Missing required field: taskId" }, { status: 400 })
        );
      }
      const reason = typeof body.reason === "string" ? body.reason.trim() : "";
      const result = await closeTask(taskId, "admin", reason || undefined);
      if (!result.ok) {
        return withNoCache(NextResponse.json({ ok: false, error: result.error }, { status: 500 }));
      }
      return withNoCache(NextResponse.json({ ok: true }));
    }
    if (action === "mark_need_complete") {
      const needId = typeof body.NeedID === "string" ? body.NeedID.trim() : "";
      const userPhone = normalizePhone10(body.UserPhone ?? body.userPhone ?? body.phone);

      if (!needId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "NeedID required" }, { status: 400 })
        );
      }
      if (!userPhone) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "UserPhone required" }, { status: 400 })
        );
      }

      const supabase = await createClient();
      const { data: need, error: needError } = await supabase
        .from("needs")
        .select("need_id, user_phone")
        .eq("need_id", needId)
        .maybeSingle();

      if (needError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: needError.message }, { status: 500 })
        );
      }
      if (!need) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Need not found" }, { status: 404 })
        );
      }
      if (String(need.user_phone || "").trim() !== userPhone) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Need ownership mismatch" }, { status: 403 })
        );
      }

      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("needs")
        .update({
          status: "completed",
          completed_at: nowIso,
          updated_at: nowIso,
        })
        .eq("need_id", needId);

      if (updateError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
        );
      }

      return withNoCache(
        NextResponse.json({
          ok: true,
          status: "success",
          NeedID: needId,
          message: "Need marked completed",
        })
      );
    }
    if (action === "close_need") {
      const needId = typeof body.NeedID === "string" ? body.NeedID.trim() : "";
      const userPhone = normalizePhone10(body.UserPhone ?? body.userPhone ?? body.phone);

      if (!needId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "NeedID required" }, { status: 400 })
        );
      }
      if (!userPhone) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "UserPhone required" }, { status: 400 })
        );
      }

      const supabase = await createClient();
      const { data: need, error: needError } = await supabase
        .from("needs")
        .select("need_id, user_phone")
        .eq("need_id", needId)
        .maybeSingle();

      if (needError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: needError.message }, { status: 500 })
        );
      }
      if (!need) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Need not found" }, { status: 404 })
        );
      }
      if (String(need.user_phone || "").trim() !== userPhone) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Need ownership mismatch" }, { status: 403 })
        );
      }

      const nowIso = new Date().toISOString();
      const { error: updateError } = await supabase
        .from("needs")
        .update({
          status: "closed",
          closed_at: nowIso,
          closed_by: "user",
          updated_at: nowIso,
        })
        .eq("need_id", needId);

      if (updateError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: updateError.message }, { status: 500 })
        );
      }

      return withNoCache(
        NextResponse.json({
          ok: true,
          status: "success",
          NeedID: needId,
          message: "Need closed",
        })
      );
    }
    if (action === "create_need") {
      const userPhone = normalizePhone10(body.UserPhone ?? body.userPhone ?? body.phone);
      const hasAnonymousChoice = body.IsAnonymous !== undefined || body.isAnonymous !== undefined;
      const isAnonymous = normalizeNeedBoolean(
        body.IsAnonymous !== undefined ? body.IsAnonymous : body.isAnonymous
      );
      let displayName = String(body.DisplayName ?? body.displayName ?? "").trim();
      const category = String(body.Category ?? body.category ?? "").trim();
      const rawAreasInput = body.Areas ?? body.areas ?? body.Area ?? body.area ?? "";
      const areasList = (Array.isArray(rawAreasInput)
        ? rawAreasInput.map((v) => String(v ?? ""))
        : String(rawAreasInput).split(",")
      )
        .map((v) => v.trim())
        .filter((v) => v.length > 0 && v.toLowerCase() !== "all areas")
        .filter((v, i, arr) => arr.indexOf(v) === i);
      const area = areasList.join(", ");
      const title = String(body.Title ?? body.title ?? "").trim();
      const description = String(body.Description ?? body.description ?? "").trim();
      const validDays = normalizeNeedValidDays(
        body.ValidDays !== undefined ? body.ValidDays : body.validDays
      );

      if (!userPhone) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "UserPhone required" }, { status: 400 })
        );
      }
      if (!hasAnonymousChoice) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "IsAnonymous required" }, { status: 400 })
        );
      }
      if (!displayName && !isAnonymous) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "DisplayName required" }, { status: 400 })
        );
      }
      if (!category) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Category required" }, { status: 400 })
        );
      }
      if (areasList.length === 0) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "At least 1 area required" }, { status: 400 })
        );
      }
      if (areasList.length > 5) {
        return withNoCache(
          NextResponse.json(
            { ok: false, error: "You can select up to 5 areas only." },
            { status: 400 }
          )
        );
      }
      if (!title) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "Title required" }, { status: 400 })
        );
      }

      if (isAnonymous) {
        displayName = "";
      }

      const supabase = await createClient();
      const nowIso = new Date().toISOString();
      const expiresAtIso = new Date(Date.now() + validDays * 24 * 60 * 60 * 1000).toISOString();
      const maxCreateNeedAttempts = 5;
      let needId = "";
      let insertError: { message: string; code?: string | null } | null = null;

      for (let attempt = 0; attempt < maxCreateNeedAttempts; attempt += 1) {
        const { data: latestNeed, error: latestNeedError } = await supabase
          .from("needs")
          .select("need_id")
          .order("need_id", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (latestNeedError) {
          return withNoCache(
            NextResponse.json({ ok: false, error: latestNeedError.message }, { status: 500 })
          );
        }

        const latestSeqMatch = String(latestNeed?.need_id || "").match(/^ND-(\d+)$/i);
        const nextSeq = (latestSeqMatch ? Number(latestSeqMatch[1]) || 0 : 0) + 1;
        needId = `ND-${String(nextSeq).padStart(4, "0")}`;

        const insertResult = await supabase.from("needs").insert({
          need_id: needId,
          user_phone: userPhone,
          display_name: displayName,
          is_anonymous: isAnonymous,
          category,
          area,
          title,
          description,
          status: "open",
          created_at: nowIso,
          updated_at: nowIso,
          valid_days: validDays,
          expires_at: expiresAtIso,
          completed_at: null,
          closed_at: null,
          closed_by: "",
          is_hidden: false,
          views_count: 0,
          responses_count: 0,
          admin_note: "",
          priority_rank: 0,
        });

        insertError = insertResult.error
          ? { message: insertResult.error.message, code: insertResult.error.code }
          : null;
        if (!insertError) break;

        const isDuplicateNeedId =
          insertError.code === "23505" ||
          /duplicate/i.test(insertError.message) ||
          /unique/i.test(insertError.message);
        if (!isDuplicateNeedId) {
          return withNoCache(
            NextResponse.json({ ok: false, error: insertError.message }, { status: 500 })
          );
        }
      }

      if (insertError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: insertError.message }, { status: 500 })
        );
      }

      return withNoCache(
        NextResponse.json({
          ok: true,
          status: "success",
          message: "Need created",
          NeedID: needId,
          ValidDays: validDays,
        })
      );
    }
    if (action === "get_needs") {
      const categoryFilter = typeof body.Category === "string" ? body.Category.trim().toLowerCase() : "";
      const areaFilter = typeof body.Area === "string" ? body.Area.trim().toLowerCase() : "";

      const supabase = await createClient();
      const { data, error } = await supabase
        .from("needs")
        .select("*")
        .eq("is_hidden", false)
        .order("created_at", { ascending: false });

      if (error) {
        return withNoCache(
          NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        );
      }

      return withNoCache(
        NextResponse.json({
          ok: true,
          needs: (data ?? [])
            .filter((need) => {
              const status = String(need.status || "").trim().toLowerCase() || "open";
              const isHidden = need.is_hidden === true;
              const currentStatus = getNeedCurrentStatus(status, need.expires_at, isHidden);
              const needAreas = String(need.area || "")
                .split(",")
                .map((a) => a.trim().toLowerCase())
                .filter(Boolean);
              if (currentStatus !== "open") return false;
              if (
                categoryFilter &&
                String(need.category || "").trim().toLowerCase() !== categoryFilter
              ) {
                return false;
              }
              if (areaFilter && !needAreas.includes(areaFilter)) {
                return false;
              }
              return true;
            })
            .map((need) => {
              const isAnonymous = need.is_anonymous === true;
              const displayName = String(need.display_name || "");
              const status = String(need.status || "");
              const isHidden = need.is_hidden === true;
              return {
                NeedID: need.need_id,
                UserPhone: need.user_phone,
                DisplayName: displayName,
                IsAnonymous: isAnonymous,
                PosterLabel: isAnonymous ? "Anonymous" : displayName,
                Category: need.category,
                Area: need.area,
                Title: need.title,
                Description: need.description,
                Status: status,
                CurrentStatus: getNeedCurrentStatus(status, need.expires_at, isHidden),
                ViewsCount: 0,
                ResponsesCount: 0,
                CreatedAt: formatChatTimestamp(need.created_at),
                UpdatedAt: formatChatTimestamp(need.updated_at),
                ValidDays: need.valid_days,
                ExpiresAt: formatChatTimestamp(need.expires_at),
                CompletedAt: formatChatTimestamp(need.completed_at),
                ClosedAt: formatChatTimestamp(need.closed_at),
                ClosedBy: need.closed_by,
                AdminNote: "",
                PriorityRank: 0,
                IsHidden: isHidden,
              };
            }),
        })
      );
    }
    if (action === "get_my_needs") {
      const userPhone = typeof body.UserPhone === "string" ? body.UserPhone.trim() : "";
      const normalizedPhone = normalizePhone10(userPhone);

      if (!normalizedPhone) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "UserPhone is required." }, { status: 400 })
        );
      }

      const supabase = await createClient();
      const { data, error } = await supabase
        .from("needs")
        .select("*")
        .eq("user_phone", normalizedPhone)
        .order("created_at", { ascending: false });

      if (error) {
        return withNoCache(
          NextResponse.json({ ok: false, error: error.message }, { status: 500 })
        );
      }

      return withNoCache(
        NextResponse.json({
          ok: true,
          needs: (data ?? []).map((need) => {
            const isAnonymous = need.is_anonymous === true;
            const displayName = String(need.display_name || "");
            const status = String(need.status || "");
            const isHidden = need.is_hidden === true;
            return {
              NeedID: need.need_id,
              UserPhone: need.user_phone,
              DisplayName: displayName,
              IsAnonymous: isAnonymous,
              PosterLabel: isAnonymous ? "Anonymous" : displayName,
              Category: need.category,
              Area: need.area,
              Title: need.title,
              Description: need.description,
              Status: status,
              CurrentStatus: getNeedCurrentStatus(status, need.expires_at, isHidden),
              CreatedAt: formatChatTimestamp(need.created_at),
              UpdatedAt: formatChatTimestamp(need.updated_at),
              ValidDays: need.valid_days,
              ExpiresAt: formatChatTimestamp(need.expires_at),
              CompletedAt: formatChatTimestamp(need.completed_at),
              ClosedAt: formatChatTimestamp(need.closed_at),
              ClosedBy: need.closed_by,
              IsHidden: isHidden,
            };
          }),
        })
      );
    }
    if (action === "chat_create_or_get_thread") {
      const result = await createOrGetChatThreadFromSupabase(body);
      return withNoCache(NextResponse.json(result));
    }
    if (action === "chat_get_threads") {
      const result = await getChatThreadsFromSupabase(body);
      return withNoCache(NextResponse.json(result));
    }
    if (action === "chat_get_messages") {
      const result = await getChatMessagesFromSupabase(body);
      return withNoCache(NextResponse.json(result));
    }
    if (action === "chat_mark_read") {
      const result = await markChatReadFromSupabase(body);
      return withNoCache(NextResponse.json(result));
    }
    if (action === "chat_send_message") {
      const result = await sendChatMessageFromSupabase(body);
      return withNoCache(NextResponse.json(result));
    }
    if (action === "admin_list_chat_threads" || action === "get_admin_chat_threads") {
      // Supabase is the source of truth. An empty result is a clean empty
      // inbox, not a signal to fall back to Apps Script.
      const result = await getAdminChatThreadsFromSupabase(body);
      const normalized = normalizeAdminPayload(action, result) ?? result;
      return withNoCache(NextResponse.json(normalized));
    }
    if (action === "admin_get_chat_thread") {
      // No GAS hydration: a missing thread is a real 404 from Supabase.
      const result = await getAdminChatThreadFromSupabase(body);
      const normalized = normalizeAdminPayload(action, result) ?? result;
      return withNoCache(
        NextResponse.json(normalized, { status: result.ok ? 200 : 404 })
      );
    }
    if (action === "close_chat_thread") {
      const threadId =
        typeof body.ThreadID === "string"
          ? body.ThreadID.trim()
          : typeof body.threadId === "string"
            ? body.threadId.trim()
            : "";
      if (!threadId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "ThreadID required" }, { status: 400 })
        );
      }
      const result = await updateChatThreadStatusFromSupabase({
        threadId,
        threadStatus: "closed",
        reason: typeof body.Reason === "string" ? body.Reason.trim() : "",
        adminActorPhone:
          typeof body.AdminActorPhone === "string" ? body.AdminActorPhone.trim() : "",
      });
      return withNoCache(
        NextResponse.json(
          result.ok ? { ok: true } : { ok: false, error: result.error },
          { status: result.ok ? 200 : 500 }
        )
      );
    }
    if (action === "admin_update_chat_thread_status") {
      const threadId = typeof body.ThreadID === "string" ? body.ThreadID.trim() : "";
      const threadStatus = typeof body.ThreadStatus === "string" ? body.ThreadStatus.trim() : "";
      const reason = typeof body.Reason === "string" ? body.Reason.trim() : "";
      const adminActorPhone = typeof body.AdminActorPhone === "string" ? body.AdminActorPhone.trim() : "";
      if (!threadId || !threadStatus) {
        return withNoCache(
          NextResponse.json(
            { ok: false, error: "Missing required fields: ThreadID, ThreadStatus" },
            { status: 400 }
          )
        );
      }
      const result = await updateChatThreadStatusFromSupabase({ threadId, threadStatus, reason, adminActorPhone });
      const normalized = normalizeAdminPayload(action, result) ?? result;
      return withNoCache(
        NextResponse.json(normalized, { status: result.ok ? 200 : 500 })
      );
    }
    if (action === "need_chat_create_or_get_thread") {
      const needId = typeof body.NeedID === "string" ? body.NeedID.trim() : "";
      const responderPhone =
        typeof body.ResponderPhone === "string"
          ? body.ResponderPhone.trim()
          : typeof body.UserPhone === "string"
            ? body.UserPhone.trim()
            : "";
      const result = await createOrGetNeedChatThreadFromSupabase(needId, responderPhone);
      return withNoCache(
        NextResponse.json(result, { status: result.ok ? 200 : 500 })
      );
    }
    if (action === "need_chat_get_threads_for_need") {
      const needId = typeof body.NeedID === "string" ? body.NeedID.trim() : "";
      const userPhone = typeof body.UserPhone === "string" ? body.UserPhone.trim() : "";

      if (!needId) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "NeedID is required." }, { status: 400 })
        );
      }
      if (!userPhone) {
        return withNoCache(
          NextResponse.json({ ok: false, error: "UserPhone is required." }, { status: 400 })
        );
      }

      const threads = await getNeedChatThreadsForNeedFromSupabase(needId, userPhone);
      return withNoCache(
        NextResponse.json({
          ok: true,
          threads: threads.map((thread) => ({
            ThreadID: thread.thread_id,
            NeedID: thread.need_id,
            PosterPhone: thread.poster_phone,
            ResponderPhone: thread.responder_phone,
            Status: thread.status,
            CreatedAt: formatChatTimestamp(thread.created_at),
            UpdatedAt: formatChatTimestamp(thread.updated_at),
            LastMessageAt: formatChatTimestamp(thread.last_message_at),
            LastMessageBy: thread.last_message_by,
            UnreadPosterCount: thread.unread_poster_count,
            UnreadResponderCount: thread.unread_responder_count,
          })),
        })
      );
    }
    if (action === "need_chat_get_messages") {
      const result = await getNeedChatMessagesFromSupabase(body);
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 500 }));
    }
    if (action === "need_chat_mark_read") {
      const result = await markNeedChatReadFromSupabase(body);
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 500 }));
    }
    if (action === "need_chat_send_message") {
      const result = await sendNeedChatMessageFromSupabase(body);
      return withNoCache(NextResponse.json(result, { status: result.ok ? 200 : 500 }));
    }
    if (action === "provider_register") {
      const phone = typeof body.phone === "string" ? body.phone.trim() : "";
      const name = typeof body.name === "string" ? body.name.trim() : "";
      const categories = Array.isArray(body.categories) ? body.categories : [];
      const areas = Array.isArray(body.areas) ? body.areas : [];
      const pendingNewCategories = Array.isArray(body.pendingNewCategories)
        ? body.pendingNewCategories
        : [];
      const pendingNewAreas = Array.isArray(body.pendingNewAreas)
        ? body.pendingNewAreas
        : [];
      if (!phone || !name || categories.length === 0 || areas.length === 0) {
        return withNoCache(
          NextResponse.json(
            { ok: false, error: "Missing required provider registration fields" },
            { status: 400 }
          )
        );
      }

      const supabase = await createClient();
      const [{ data: approvedCategories, error: approvedCategoriesError }, { data: approvedAreas, error: approvedAreasError }] =
        await Promise.all([
          supabase.from("categories").select("name").eq("active", true),
          supabase.from("areas").select("area_name").eq("active", true),
        ]);

      if (approvedCategoriesError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: approvedCategoriesError.message }, { status: 500 })
        );
      }
      if (approvedAreasError) {
        return withNoCache(
          NextResponse.json({ ok: false, error: approvedAreasError.message }, { status: 500 })
        );
      }

      const approvedCategoryNames = new Set(
        (approvedCategories ?? []).map((row) => String(row.name || "").trim().toLowerCase())
      );
      const approvedAreaNames = new Set(
        (approvedAreas ?? []).map((row) => String(row.area_name || "").trim().toLowerCase())
      );
      const hasNewCategory = categories.some(
        (category) => !approvedCategoryNames.has(String(category || "").trim().toLowerCase())
      );
      const hasNewArea = areas.some(
        (area) => !approvedAreaNames.has(String(area || "").trim().toLowerCase())
      );
      const pendingApproval = hasNewCategory || hasNewArea ? "yes" : "no";

      // Pre-check: if phone already exists, return 409 with the existing
      // provider_id so the UI can deep-link to login/edit. The unique
      // constraint check below still guards against concurrent inserts.
      const { data: existingByPhone } = await supabase
        .from("providers")
        .select("provider_id")
        .eq("phone", phone)
        .maybeSingle();
      if (existingByPhone?.provider_id) {
        return withNoCache(
          NextResponse.json(
            {
              ok: false,
              error: "already_registered",
              existingProviderId: existingByPhone.provider_id,
            },
            { status: 409 }
          )
        );
      }

      // Duplicate-name detection: any existing provider whose normalized
      // full_name matches this registration but whose phone differs.
      const duplicateMatches = await findDuplicateNameProviders(name, phone);
      const isDuplicateName = duplicateMatches.length > 0;
      const nowIso = new Date().toISOString();

      const providerInsertRow: Record<string, unknown> = {
        full_name: name,
        phone,
        business_name: null,
        experience_years: null,
        notes: null,
        status: pendingApproval === "yes" ? "pending" : "active",
        verified: isDuplicateName ? "no" : "yes",
      };
      if (isDuplicateName) {
        providerInsertRow.duplicate_name_review_status = "pending";
        providerInsertRow.duplicate_name_matches = duplicateMatches.map((m) => m.provider_id);
        providerInsertRow.duplicate_name_flagged_at = nowIso;
      }

      const { data: insertedProvider, error: providerError } = await supabase
        .from("providers")
        .insert(providerInsertRow)
        .select("provider_id")
        .single();

      if (providerError) {
        const code = (providerError as { code?: string }).code;
        const message = String(providerError.message || "");
        if (code === "23505" && message.includes("providers_phone_key")) {
          return withNoCache(
            NextResponse.json(
              { ok: false, error: "already_registered" },
              { status: 409 }
            )
          );
        }
        return withNoCache(
          NextResponse.json(
            { ok: false, error: message || "Failed to create provider" },
            { status: 500 }
          )
        );
      }

      const providerId = insertedProvider.provider_id;

      // Best-effort rollback for child-insert failures. Supabase JS has no
      // transactions, so on partial failure we delete the orphan rows
      // ourselves to avoid leaving a provider with no services/areas.
      const rollbackProvider = async () => {
        await supabase.from("providers").delete().eq("provider_id", providerId);
      };

      const serviceRows = categories.map((category) => ({
        provider_id: providerId,
        category: String(category),
      }));

      const { error: servicesError } = await supabase
        .from("provider_services")
        .insert(serviceRows);

      if (servicesError) {
        await rollbackProvider();
        return withNoCache(
          NextResponse.json(
            { ok: false, error: servicesError.message || "Failed to create provider services" },
            { status: 500 }
          )
        );
      }

      const areaRows = areas.map((area) => ({
        provider_id: providerId,
        area: String(area),
      }));

      const { error: areasError } = await supabase
        .from("provider_areas")
        .insert(areaRows);

      if (areasError) {
        await supabase.from("provider_services").delete().eq("provider_id", providerId);
        await rollbackProvider();
        return withNoCache(
          NextResponse.json(
            { ok: false, error: areasError.message || "Failed to create provider areas" },
            { status: 500 }
          )
        );
      }

      // Queue unmapped (custom) areas for admin review — non-fatal
      if (pendingNewAreas.length > 0) {
        await Promise.allSettled(
          pendingNewAreas.map((rawArea: unknown) =>
            queueUnmappedAreaForReview({
              rawArea: String(rawArea || ""),
              sourceType: "provider_register",
              sourceRef: providerId,
            })
          )
        );
      }

      // Queue unmapped (custom) categories for admin review — non-fatal.
      // Mirrors the area queue. Each new category becomes one pending row;
      // the provider_services row was already inserted above so the provider
      // is matchable, and the admin approval handler upserts the canonical
      // categories row when the request is approved.
      if (pendingNewCategories.length > 0) {
        await Promise.allSettled(
          pendingNewCategories.map((rawCategory: unknown) => {
            const requestedCategory = String(rawCategory || "").trim();
            if (!requestedCategory) return Promise.resolve();
            return adminSupabase.from("pending_category_requests").insert({
              request_id: `PCR-${crypto.randomUUID()}`,
              provider_id: providerId,
              provider_name: name,
              phone,
              requested_category: requestedCategory,
              status: "pending",
              created_at: nowIso,
            });
          })
        );
      }

      const effectiveVerified = isDuplicateName ? "no" : "yes";
      const effectivePendingApproval = pendingApproval;

      return withNoCache(
        NextResponse.json({
          ok: true,
          providerId,
          verified: effectiveVerified,
          pendingApproval: effectivePendingApproval,
          duplicateNameReviewStatus: isDuplicateName ? "pending" : null,
          duplicateNameMatches: isDuplicateName
            ? duplicateMatches.map((m) => m.provider_id)
            : [],
          requestedNewCategories: pendingNewCategories,
          requestedNewAreas: pendingNewAreas,
          provider: {
            ProviderID: providerId,
            Name: name,
            Phone: phone,
            Verified: effectiveVerified,
            PendingApproval: effectivePendingApproval,
            Status: pendingApproval === "yes" ? "pending" : "active",
            DuplicateNameReviewStatus: isDuplicateName ? "pending" : null,
          },
        })
      );
    }
    // Fail closed: any POST action that did not match a native intercept
    // above is not supported. The legacy Apps Script POST fallthrough has
    // been removed.
    return withNoCache(
      NextResponse.json(
        {
          ok: false,
          error: "Unsupported action",
          action,
        },
        { status: 400 }
      )
    );
  } catch (error: any) {
    return withNoCache(
      NextResponse.json(
        {
          ok: false,
          error: "KK_PROXY_POST_FAILED",
          message: error?.message || "Failed to proxy POST request",
        },
        { status: 500 }
      )
    );
  }
}
