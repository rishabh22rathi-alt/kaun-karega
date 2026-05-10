import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  PROVIDER_PLEDGE_VERSION,
  isPledgeAccepted,
} from "@/lib/disclaimer";

// Provider pledge state.
//   GET  /api/provider/pledge   → current acceptance for the session phone
//   POST /api/provider/pledge   → record acceptance for the session phone
//
// Auth: every entry point goes through `getAuthSession({cookie})` which
// verifies the signed kk_auth_session cookie. There is no admin-only
// surface here — every authenticated provider reads and writes their
// own row, keyed by the verified session phone.
//
// Provider rows are RLS-protected; this route uses the service-role
// client (mirrors my-requests / provider-stats / chatActor precedents).
// Phone is the natural key — historical data has the phone stored as
// both 10-digit ("9XXXXXXXXX") and 12-digit ("919XXXXXXXXX") variants
// depending on which OTP-verify route wrote it. Reads union both forms;
// writes target the existing provider row found by either format.
//
// This route NEVER inserts a providers row. The provider must already
// exist (registered via /api/kk provider_register, or imported via an
// admin path) before they can accept the pledge here. New-registration
// pledge persistence stays in the provider_register branch — Phase 3
// continues to write pledge_version + pledge_accepted_at on the insert
// row for fresh signups.

export const runtime = "nodejs";

const ACCEPTED_VERSIONS = new Set<string>([PROVIDER_PLEDGE_VERSION]);

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

function phoneVariants(sessionPhone: string): string[] {
  const phone10 = normalizePhone10(sessionPhone);
  if (phone10.length !== 10) {
    const trimmed = String(sessionPhone || "").trim();
    return trimmed ? [trimmed] : [];
  }
  return [phone10, `91${phone10}`];
}

type ProviderPledgeRow = {
  provider_id: string;
  phone: string | null;
  pledge_version: string | null;
  pledge_accepted_at: string | null;
};

// Find the providers row for this session phone across both stored
// formats. Prefers the row whose phone normalizes back to the same
// 10-digit form (so a stale 12-digit row never wins over a current
// 10-digit row written by a later verify-otp deploy).
async function findProviderRow(
  sessionPhone: string
): Promise<ProviderPledgeRow | null> {
  const variants = phoneVariants(sessionPhone);
  if (variants.length === 0) return null;
  const phone10 = normalizePhone10(sessionPhone);

  const { data, error } = await adminSupabase
    .from("providers")
    .select("provider_id, phone, pledge_version, pledge_accepted_at")
    .in("phone", variants)
    .limit(5);

  if (error) {
    throw new Error(error.message || "DB_ERROR");
  }
  if (!data || data.length === 0) return null;

  const preferred =
    data.find(
      (r) =>
        typeof (r as { provider_id?: unknown }).provider_id === "string" &&
        String((r as { provider_id?: unknown }).provider_id || "").length >
          0 &&
        normalizePhone10((r as { phone?: unknown }).phone) === phone10
    ) ?? data[0];

  return {
    provider_id: String(
      (preferred as { provider_id?: unknown }).provider_id || ""
    ),
    phone: ((preferred as { phone?: unknown }).phone as string | null) ?? null,
    pledge_version:
      ((preferred as { pledge_version?: unknown })
        .pledge_version as string | null) ?? null,
    pledge_accepted_at:
      ((preferred as { pledge_accepted_at?: unknown })
        .pledge_accepted_at as string | null) ?? null,
  };
}

export async function GET(request: Request) {
  const session = await getAuthSession({
    cookie: request.headers.get("cookie") ?? "",
  });
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let row: ProviderPledgeRow | null;
  try {
    row = await findProviderRow(session.phone);
  } catch (err) {
    console.error(
      "[api/provider/pledge GET] provider lookup failed",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { ok: false, error: "DB_ERROR" },
      { status: 500 }
    );
  }

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "PROVIDER_NOT_FOUND" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    ok: true,
    accepted: isPledgeAccepted({
      version: row.pledge_version,
      acceptedAt: row.pledge_accepted_at,
    }),
    version: row.pledge_version,
    acceptedAt: row.pledge_accepted_at,
  });
}

export async function POST(request: Request) {
  const session = await getAuthSession({
    cookie: request.headers.get("cookie") ?? "",
  });
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: { version?: unknown };
  try {
    body = (await request.json()) as { version?: unknown };
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON_BODY" },
      { status: 400 }
    );
  }

  const requestedVersion =
    typeof body.version === "string" ? body.version.trim() : "";
  if (!ACCEPTED_VERSIONS.has(requestedVersion)) {
    return NextResponse.json(
      { ok: false, error: "INVALID_VERSION" },
      { status: 400 }
    );
  }

  let row: ProviderPledgeRow | null;
  try {
    row = await findProviderRow(session.phone);
  } catch (err) {
    console.error(
      "[api/provider/pledge POST] provider lookup failed",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      { ok: false, error: "DB_ERROR" },
      { status: 500 }
    );
  }

  if (!row) {
    return NextResponse.json(
      { ok: false, error: "PROVIDER_NOT_FOUND" },
      { status: 404 }
    );
  }

  // Server clamps the timestamp — frontend never supplies one. Update
  // the existing row in place (no insert here; row creation is owned
  // exclusively by the provider_register branch in /api/kk).
  const acceptedAtIso = new Date().toISOString();
  const { error: updateErr } = await adminSupabase
    .from("providers")
    .update({
      pledge_version: requestedVersion,
      pledge_accepted_at: acceptedAtIso,
    })
    .eq("provider_id", row.provider_id);

  if (updateErr) {
    console.error(
      "[api/provider/pledge POST] update failed",
      updateErr.message
    );
    return NextResponse.json(
      { ok: false, error: "DB_ERROR" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    accepted: true,
    version: requestedVersion,
    acceptedAt: acceptedAtIso,
  });
}
