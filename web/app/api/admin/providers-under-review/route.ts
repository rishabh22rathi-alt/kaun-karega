import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { buildProvidersUnderReview } from "@/lib/admin/adminProviderReview";
import {
  readThroughSnapshotCache,
  type CacheMetadata,
} from "@/lib/admin/snapshotCache";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// Short snapshot cache: this is an actionable queue, so a 15-minute
// TTL keeps the load light while staying fresh enough that
// admin-handled approvals are reflected on the next opens.
// Manual Refresh + provider mutations both invalidate the key.
const CACHE_KEY = "providers_under_review";
const CACHE_TTL_SECONDS = 15 * 60;

// GET /api/admin/providers-under-review
//
// Provider-centric review aggregator. Returns one entry per provider
// that has at least one open item across:
//   - pending_category_requests (status='pending')
//   - category_aliases (active=false, submitted_by_provider_id IS NOT NULL)
//   - area_review_queue (status='pending', source_type provider_*)
//
// Read-only. The Approve / Reject / Resolve actions in the UI fan
// out to the existing endpoints — see the inline notes on the
// ProvidersTab buttons. We deliberately keep the payload narrow
// (no message text, no raw row blobs beyond the identifiers the UI
// needs to render and act).
//
// Auth: requireAdminSession.

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const forceRefresh =
    new URL(request.url).searchParams.get("refresh") === "1";

  type Payload = {
    totalUnderReview: number;
    providers: Awaited<ReturnType<typeof buildProvidersUnderReview>>["providers"];
  };

  let payload: Payload;
  let cache: CacheMetadata;
  try {
    const result = await readThroughSnapshotCache<Payload>({
      key: CACHE_KEY,
      ttlSeconds: CACHE_TTL_SECONDS,
      forceRefresh,
      adminPhone: auth.admin.phone,
      compute: async () => {
        const r = await buildProvidersUnderReview();
        return {
          totalUnderReview: r.providers.length,
          providers: r.providers,
        };
      },
    });
    payload = result.payload;
    cache = result.cache;
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to build providers under review",
      },
      { status: 500 }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      totalUnderReview: payload.totalUnderReview,
      providers: payload.providers,
      cache,
    },
    { status: 200 }
  );
}
