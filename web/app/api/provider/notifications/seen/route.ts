import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { getAuthSession } from "@/lib/auth";

// POST /api/provider/notifications/seen
//
// Body (all fields optional):
//   { ids?: string[] }
//
// Behavior:
//   - Cookie-session auth. Resolves the calling provider's provider_id from
//     the same `kk_auth_session` cookie used by /api/provider/notifications.
//   - If `ids` is provided and non-empty, marks only those rows seen.
//   - If `ids` is omitted (or empty), marks ALL currently-unseen rows for
//     the calling provider seen.
//   - The provider_id filter is the security gate: the UPDATE always
//     includes `WHERE provider_id = <caller's id>`, so a malicious caller
//     cannot mark another provider's notifications seen by passing their
//     IDs. Cross-provider tampering is structurally prevented.
//
// Response: { ok, updatedCount, updatedIds }
//   updatedIds enumerates exactly which rows were flipped, so the client
//   can do precise local reconciliation.

const onlyDigits = (s: string) => String(s || "").replace(/\D/g, "");

function normalizePhone10(value: string): string {
  const digits = onlyDigits(value);
  if (!digits) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
}

async function resolveProviderIdFromCookies(
  request: Request
): Promise<{ providerId: string; error?: { code: string; status: number } }> {
  const cookieHeader = request.headers.get("cookie") || "";
  const session = await getAuthSession({ cookie: cookieHeader });
  const phone = normalizePhone10(String(session?.phone || ""));
  if (!session || phone.length !== 10) {
    return { providerId: "", error: { code: "AUTH_REQUIRED", status: 401 } };
  }
  const { data: providerRow, error } = await adminSupabase
    .from("providers")
    .select("provider_id")
    .eq("phone", phone)
    .maybeSingle();
  if (error) {
    console.error(
      "[provider/notifications/seen] provider lookup failed",
      error.message
    );
    return { providerId: "", error: { code: "DB_ERROR", status: 500 } };
  }
  if (!providerRow) {
    return {
      providerId: "",
      error: { code: "PROVIDER_NOT_FOUND", status: 404 },
    };
  }
  return { providerId: String(providerRow.provider_id || "") };
}

export async function POST(request: Request) {
  const { providerId, error: authErr } = await resolveProviderIdFromCookies(
    request
  );
  if (authErr) {
    return NextResponse.json(
      { ok: false, error: authErr.code },
      { status: authErr.status }
    );
  }

  // Empty / malformed body is intentionally tolerated — treated as
  // "mark all unseen for this provider".
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const idsRaw = Array.isArray(body.ids) ? (body.ids as unknown[]) : null;
  const ids = idsRaw
    ? idsRaw
        .map((id) => String(id ?? "").trim())
        .filter((id) => id.length > 0)
    : null;

  // Build the update with the provider scope first; this is the security
  // boundary. Then optionally narrow by ids.
  let updateQuery = adminSupabase
    .from("provider_notifications")
    .update({ seen_at: new Date().toISOString() })
    .eq("provider_id", providerId)
    .is("seen_at", null);

  if (ids && ids.length > 0) {
    updateQuery = updateQuery.in("id", ids);
  }

  // .select("id") returns the rows we just updated, so we can echo back
  // exactly which IDs flipped — useful for client reconciliation.
  const { data, error } = await updateQuery.select("id");
  if (error) {
    console.error(
      "[provider/notifications/seen] update failed",
      error.message
    );
    return NextResponse.json({ ok: false, error: "DB_ERROR" }, { status: 500 });
  }

  const updatedIds = (data || []).map((row) => String(row.id));
  return NextResponse.json({
    ok: true,
    updatedCount: updatedIds.length,
    updatedIds,
  });
}
