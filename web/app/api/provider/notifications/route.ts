import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { getAuthSession } from "@/lib/auth";

// GET /api/provider/notifications
// Returns the recent rows of provider_notifications for the calling provider.
// Auth via the same cookie-session pattern used by
// /api/provider/dashboard-profile: phone from session → providers row →
// provider_id → notifications.
//
// Response shape mirrors what the bell expects:
//   { ok, notifications: [{ id, type, title, message, href, createdAt, seen }] }
//
// For MVP we cap at 50 most recent rows. Bell only renders ~5-10 active
// items per group, so a 50-row ceiling is generous without being expensive.

const norm = (s: string) => s.trim().replace(/\D/g, "");

function normalizePhone10(value: string): string {
  const digits = norm(value);
  if (!digits) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export async function GET(request: Request) {
  const cookieHeader = request.headers.get("cookie") || "";
  const session = getAuthSession({ cookie: cookieHeader });
  const phone = normalizePhone10(String(session?.phone || ""));
  if (!session || phone.length !== 10) {
    return NextResponse.json(
      { ok: false, error: "AUTH_REQUIRED" },
      { status: 401 }
    );
  }

  // Resolve provider_id from phone. Service role bypasses RLS; we scope by
  // phone explicitly here.
  const { data: providerRow, error: providerErr } = await adminSupabase
    .from("providers")
    .select("provider_id")
    .eq("phone", phone)
    .maybeSingle();
  if (providerErr) {
    console.error(
      "[provider/notifications GET] provider lookup failed",
      providerErr.message
    );
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }
  if (!providerRow) {
    return NextResponse.json(
      { ok: false, error: "PROVIDER_NOT_FOUND" },
      { status: 404 }
    );
  }
  const providerId = String(providerRow.provider_id || "");

  const { data, error } = await adminSupabase
    .from("provider_notifications")
    .select("id, type, title, message, href, payload_json, seen_at, created_at")
    .eq("provider_id", providerId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    console.error("[provider/notifications GET] failed", error.message);
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }

  const notifications = (data || []).map((row) => ({
    id: String(row.id),
    type: String(row.type),
    title: String(row.title),
    message: String(row.message || ""),
    href: row.href ? String(row.href) : undefined,
    createdAt: row.created_at ? String(row.created_at) : undefined,
    seen: Boolean(row.seen_at),
    payload: row.payload_json ?? null,
  }));

  return NextResponse.json({ ok: true, notifications });
}
