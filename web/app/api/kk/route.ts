import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";

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
  "admin_notification_summary",
  "get_admin_area_mappings",
  "admin_notification_logs",
  // Admin dashboard — writes
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

const APPS_SCRIPT_URL = process.env.NEXT_PUBLIC_APPS_SCRIPT_URL;

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

function buildTargetUrl(request: NextRequest): URL {
  if (!APPS_SCRIPT_URL) {
    throw new Error("NEXT_PUBLIC_APPS_SCRIPT_URL is not configured");
  }
  const target = new URL(APPS_SCRIPT_URL);
  request.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });
  return target;
}

function withNoCache(response: NextResponse) {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
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
    const targetUrl = buildTargetUrl(request);
    const upstream = await fetch(targetUrl.toString(), {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain, */*",
      },
    });

    const text = await upstream.text();
    const response = new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
    return withNoCache(response);
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
    const targetUrl = buildTargetUrl(request);
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
    const upstream = await fetch(targetUrl.toString(), {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/plain, */*",
      },
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    const response = new NextResponse(text, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
      },
    });
    return withNoCache(response);
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
