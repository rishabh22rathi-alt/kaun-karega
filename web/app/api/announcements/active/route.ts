import { NextResponse } from "next/server";

import {
  listActiveBannersForActor,
  resolveBannerActor,
  type BannerError,
} from "@/lib/announcements/banners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/announcements/active
//
// Per-actor banner reader. Returns the sanitized list of currently-
// active in-app banners the calling actor should see, ordered by
// banner_priority DESC then created_at DESC. Capped at 5 items.
//
// Auth model:
//   • Signed kk_auth_session cookie. Actor resolution chain inside
//     resolveBannerActor: admin → provider → user.
//   • Logged-out callers get { ok: true, banners: [] } (no 401),
//     so the homepage can call freely. This matches the audit and
//     avoids leaking auth state via banner endpoints.
//
// Cache:
//   • Cache-Control: no-store. Dismissals are per-actor; CDN caching
//     would serve stale banners to dismissed actors.
//
// Audience policy:
//   • 'admins' and 'provider_category' are visible (Phase 7D V1).
//   • 'providers_all', 'users', 'all' are filtered out by the helper.
//
// Response shape — sanitized:
//   { ok: true, banners: [
//     { id, title, body, deep_link, cta_label, priority,
//       dismissible, expires_at }
//   ] }
// Never returns: target_audience, target_category, status,
// recipient_count, approval fields, created_by_phone, or any
// internal metadata.

function errorStatus(code: BannerError["code"]): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "NOT_A_BANNER":
    case "BANNER_NOT_DISMISSIBLE":
    case "INVALID_INPUT":
      return 400;
    case "NOT_TARGETED":
      return 403;
    case "DB_ERROR":
    default:
      return 500;
  }
}

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, max-age=0",
};

export async function GET(request: Request) {
  const actor = await resolveBannerActor(request);
  if (!actor.ok) {
    // Logged-out — return an empty list with the no-store header so
    // edge caches don't serve a "you are not logged in" snapshot to
    // a subsequently-logged-in user on the same network.
    return NextResponse.json(
      { ok: true, banners: [] },
      { headers: NO_STORE_HEADERS }
    );
  }

  const result = await listActiveBannersForActor(actor.actorType, actor.actorKey);
  if (!result.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: result.error.code,
        message: result.error.message,
      },
      { status: errorStatus(result.error.code), headers: NO_STORE_HEADERS }
    );
  }

  return NextResponse.json(
    { ok: true, banners: result.value },
    { headers: NO_STORE_HEADERS }
  );
}
