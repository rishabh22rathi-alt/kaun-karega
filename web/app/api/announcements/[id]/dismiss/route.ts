import { NextResponse } from "next/server";

import {
  dismissBanner,
  resolveBannerActor,
  type BannerError,
} from "@/lib/announcements/banners";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = { params: Promise<{ id: string }> };

// POST /api/announcements/[id]/dismiss
//
// Records that the calling actor has dismissed the given banner.
// Idempotent — repeated POSTs return { ok: true, dismissed: true }
// because the underlying upsert uses ON CONFLICT DO NOTHING on the
// composite PK (announcement_id, actor_type, actor_key).
//
// Gates (in order):
//   1. Session required (401 UNAUTHORIZED on logged-out).
//   2. Announcement must exist (404 NOT_FOUND).
//   3. show_as_banner must be true (400 NOT_A_BANNER).
//   4. banner_dismissible must be true (400 BANNER_NOT_DISMISSIBLE).
//   5. Actor must be in the announcement's target audience
//      (403 NOT_TARGETED) — defense-in-depth so a stranger cannot
//      dismiss a banner targeted at a category they don't belong to.
//
// Audience targeting rules (mirror banners.listActiveBannersForActor):
//   • 'admins'            ⇔ actor_type='admin'
//   • 'provider_category' ⇔ actor_type='provider' AND the provider
//                           offers target_category (via
//                           provider_services join, case-insensitive)
//   • Anything else        → NOT_TARGETED

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

export async function POST(request: Request, context: RouteContext) {
  const actor = await resolveBannerActor(request);
  if (!actor.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: "UNAUTHORIZED",
        message: "Session required to dismiss banner.",
      },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const { id } = await context.params;

  const result = await dismissBanner(id, actor.actorType, actor.actorKey);
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
    { ok: true, dismissed: true },
    { headers: NO_STORE_HEADERS }
  );
}
