import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import { buildProvidersUnderReview } from "@/lib/admin/adminProviderReview";
import { buildVerifiedProviderSet } from "@/lib/admin/verifiedProviders";
import { readThroughSnapshotCache } from "@/lib/admin/snapshotCache";

// Top-level provider tile counts for the Admin Providers tab.
//
// Total       Exact `providers` row count. Independent of category state —
//             archive/disable never deletes provider rows, so the tile
//             stays consistent with "providers we know about".
//
// UnderReview Distinct providers with at least one open review item
//             across pending_category_requests, category_aliases
//             (active=false, submitted_by_provider_id), and
//             area_review_queue (provider_register / provider_update
//             sources). Sourced from `buildProvidersUnderReview`, the
//             same helper that powers /api/admin/providers-under-review,
//             so both routes always agree.
//
// Verified    Computed by the shared canonical helper
//             `buildVerifiedProviderSet()` in
//             web/lib/admin/verifiedProviders.ts. See that file for
//             the exact rule — every admin surface that reports a
//             verified count routes through it so the dashboard and
//             the Area/Region tab can never drift.
//
// Caching     Stage 1 of admin-dashboard-snapshot-cache. The whole
//             { total, verified, underReview } block is wrapped in
//             readThroughSnapshotCache under key "provider_stats" with
//             a 6-hour TTL. Force a recompute with ?refresh=1; the
//             response always carries a `cache` block describing
//             freshness. See web/lib/admin/snapshotCache.ts.

const CACHE_KEY = "provider_stats";
const CACHE_TTL_SECONDS = 6 * 60 * 60;

type ProviderStatsPayload = {
  total: number;
  verified: number;
  underReview: number;
};

async function computeProviderStats(): Promise<ProviderStatsPayload> {
  // 1. Exact total — uncapped, head-only count.
  const tTotal0 = Date.now();
  const totalRes = await adminSupabase
    .from("providers")
    .select("provider_id", { count: "exact", head: true });
  console.log(
    `[admin-perf] provider-stats providers_count took ${Date.now() - tTotal0}ms`
  );
  if (totalRes.error) {
    throw new Error(`providers count failed: ${totalRes.error.message}`);
  }
  const total = Number(totalRes.count ?? 0);

  // 2. Under-review set — single source of truth shared with the
  // canonical verified helper below. Soft-fail to an empty set so the
  // tile renders ("0 under review, N verified") instead of throwing.
  const tUr0 = Date.now();
  let underReviewSet = new Set<string>();
  try {
    const review = await buildProvidersUnderReview();
    underReviewSet = review.providerIdSet;
  } catch (err) {
    console.warn(
      "[provider-stats] under-review aggregation failed; treating as empty",
      err instanceof Error ? err.message : err
    );
  }
  console.log(
    `[admin-perf] provider-stats buildProvidersUnderReview took ${
      Date.now() - tUr0
    }ms (size=${underReviewSet.size})`
  );
  const underReview = underReviewSet.size;

  // 3. Verified count — delegated to the shared helper. Pass the
  // under-review set we just computed so the helper doesn't refetch.
  const tVer0 = Date.now();
  const verifiedSet = await buildVerifiedProviderSet({ underReviewSet });
  console.log(
    `[admin-perf] provider-stats buildVerifiedProviderSet took ${
      Date.now() - tVer0
    }ms (verified=${verifiedSet.size})`
  );

  return {
    total,
    verified: verifiedSet.size,
    underReview,
  };
}

export async function GET(request: Request) {
  // Stage 1 timing — single source of truth for "how long did
  // /api/admin/provider-stats take and where". Prefix [admin-perf]
  // for easy grepping; lightweight (no extra round-trips).
  const tRoute0 = Date.now();
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  // ?refresh=1 forces a recompute, bypassing both cache layers.
  // Any other value (missing, "0", "true", typos) keeps the
  // read-through path — only the literal "1" escalates.
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  try {
    const { payload, cache } = await readThroughSnapshotCache<ProviderStatsPayload>({
      key: CACHE_KEY,
      ttlSeconds: CACHE_TTL_SECONDS,
      forceRefresh,
      adminPhone: auth.admin.phone,
      compute: computeProviderStats,
    });
    console.log(
      `[admin-perf] provider-stats route TOTAL ${
        Date.now() - tRoute0
      }ms (total=${payload.total}, verified=${payload.verified}, underReview=${
        payload.underReview
      }, cached=${cache.cached}, refresh=${forceRefresh})`
    );
    return NextResponse.json({
      ok: true,
      data: payload,
      cache,
    });
  } catch (err) {
    console.error(
      "[admin-perf] provider-stats compute failed",
      err instanceof Error ? err.message : err
    );
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error ? err.message : "provider stats compute failed",
      },
      { status: 500 }
    );
  }
}
