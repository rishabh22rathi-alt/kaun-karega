import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  DISCLAIMER_VERSION,
  isDisclaimerFresh,
} from "@/lib/disclaimer";

// User disclaimer state.
//   GET  /api/user/disclaimer          → current acceptance for the session phone
//   POST /api/user/disclaimer/accept   → not used by this file; see route below
//   POST /api/user/disclaimer          → record acceptance for the session phone
//
// Auth: every entry point goes through `getAuthSession({cookie})` which
// verifies the signed kk_auth_session cookie. There is no admin-only
// surface here — every authenticated user reads and writes their own
// row, keyed by the verified session phone.
//
// profiles is RLS-protected; we use the service-role client (mirrors the
// my-requests + provider-stats precedents). Phone is the natural key —
// historical data has the phone stored as both 10-digit ("9XXXXXXXXX")
// and 12-digit ("919XXXXXXXXX") variants depending on which OTP-verify
// route wrote it. Reads union both forms; writes target the existing row
// when one is present, otherwise upsert in the session phone's format.

export const runtime = "nodejs";

const ACCEPTED_VERSIONS = new Set<string>([DISCLAIMER_VERSION]);

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

type ProfileDisclaimerRow = {
  phone: string | null;
  disclaimer_version: string | null;
  disclaimer_accepted_at: string | null;
};

// Returns the freshest acceptance row across phone-format variants, or
// null when no row carries a non-null acceptance timestamp. "Freshest"
// is the lexicographically-greatest ISO timestamp among matching rows.
async function readDisclaimerRow(
  sessionPhone: string
): Promise<{ row: ProfileDisclaimerRow | null; error: Error | null }> {
  const variants = phoneVariants(sessionPhone);
  if (variants.length === 0) {
    return { row: null, error: null };
  }
  const { data, error } = await adminSupabase
    .from("profiles")
    .select("phone, disclaimer_version, disclaimer_accepted_at")
    .in("phone", variants);

  if (error) {
    return { row: null, error: new Error(error.message || "DB_ERROR") };
  }

  let best: ProfileDisclaimerRow | null = null;
  for (const raw of data ?? []) {
    const row: ProfileDisclaimerRow = {
      phone: (raw as { phone?: string | null }).phone ?? null,
      disclaimer_version:
        (raw as { disclaimer_version?: string | null }).disclaimer_version ??
        null,
      disclaimer_accepted_at:
        (raw as { disclaimer_accepted_at?: string | null })
          .disclaimer_accepted_at ?? null,
    };
    if (!row.disclaimer_accepted_at) continue;
    if (
      !best ||
      (row.disclaimer_accepted_at ?? "") > (best.disclaimer_accepted_at ?? "")
    ) {
      best = row;
    }
  }
  return { row: best, error: null };
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

  const { row, error } = await readDisclaimerRow(session.phone);
  if (error) {
    console.error(
      "[api/user/disclaimer GET] profile lookup failed",
      error.message
    );
    return NextResponse.json(
      { ok: false, error: "DB_ERROR" },
      { status: 500 }
    );
  }

  const version = row?.disclaimer_version ?? null;
  const acceptedAt = row?.disclaimer_accepted_at ?? null;
  const isFresh = isDisclaimerFresh({
    version,
    acceptedAt,
  });

  return NextResponse.json({
    ok: true,
    version,
    acceptedAt,
    isFresh,
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

  const variants = phoneVariants(session.phone);
  if (variants.length === 0) {
    return NextResponse.json(
      { ok: false, error: "INVALID_SESSION_PHONE" },
      { status: 400 }
    );
  }

  // Server clamps acceptedAt to now() — the client value (if any) is
  // ignored to avoid clock-game backdating.
  const acceptedAtIso = new Date().toISOString();

  // Locate the existing row across phone-format variants. If one exists,
  // update it in place so we do not create a second row in a different
  // format and end up with two acceptance histories per human.
  const { data: existingRows, error: lookupErr } = await adminSupabase
    .from("profiles")
    .select("phone")
    .in("phone", variants)
    .limit(2);
  if (lookupErr) {
    console.error(
      "[api/user/disclaimer POST] existing-row lookup failed",
      lookupErr.message
    );
    return NextResponse.json(
      { ok: false, error: "DB_ERROR" },
      { status: 500 }
    );
  }

  if (existingRows && existingRows.length > 0) {
    // Prefer the 10-digit row when both formats exist; otherwise take
    // whatever was returned first.
    const phone10 = normalizePhone10(session.phone);
    const targetPhone =
      existingRows.find(
        (r) => String((r as { phone?: unknown }).phone ?? "") === phone10
      )?.phone ?? existingRows[0].phone;

    const { error: updateErr } = await adminSupabase
      .from("profiles")
      .update({
        disclaimer_version: requestedVersion,
        disclaimer_accepted_at: acceptedAtIso,
      })
      .eq("phone", String(targetPhone || ""));
    if (updateErr) {
      console.error(
        "[api/user/disclaimer POST] update failed",
        updateErr.message
      );
      return NextResponse.json(
        { ok: false, error: "DB_ERROR" },
        { status: 500 }
      );
    }
  } else {
    // No row yet — upsert keyed by phone. Match the verify-otp insert
    // shape (role: "user", last_login_at) so a user who somehow accepts
    // the disclaimer before any login row was created still ends up with
    // a well-formed profiles row. Practically unreachable since
    // disclaimer requires an authenticated session that goes through
    // verify-otp's upsert, but the defensive default costs nothing.
    const { error: insertErr } = await adminSupabase
      .from("profiles")
      .upsert(
        {
          phone: variants[0],
          role: "user",
          disclaimer_version: requestedVersion,
          disclaimer_accepted_at: acceptedAtIso,
        },
        { onConflict: "phone" }
      );
    if (insertErr) {
      console.error(
        "[api/user/disclaimer POST] upsert failed",
        insertErr.message
      );
      return NextResponse.json(
        { ok: false, error: "DB_ERROR" },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    version: requestedVersion,
    acceptedAt: acceptedAtIso,
    isFresh: true,
  });
}
