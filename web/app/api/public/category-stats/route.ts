import { NextResponse } from "next/server";

import { getServiceBySlug } from "@/lib/seo/slugs";
import { countActiveProvidersForSlug } from "@/lib/seo/landingPageData";

/**
 * Public service-category stats — counts only, never PII.
 *
 * GET /api/public/category-stats?slug=electrician
 *
 * Why this endpoint exists:
 *   The (future) /services/[category] landing pages need a live
 *   provider count to show "{count} verified providers active in
 *   Jodhpur right now" without leaking any provider details. The
 *   existing /api/admin/provider-stats/* endpoints return rich
 *   rows (names, IDs, areas) and are admin-gated — neither
 *   suitable nor safe for public surfaces. This endpoint is the
 *   public-safe counterpart, owning its own response type so a
 *   future change to the admin endpoints can't accidentally leak
 *   data here.
 *
 * Response shape — EXACTLY these four keys, no more:
 *   { ok: true, category: string, slug: string, count: number }
 *
 * Error envelope:
 *   - 404 { ok: false, error: "INVALID_SLUG" }  — slug not in
 *     allow-list (lib/seo/slugs.ts)
 *   - 500 { ok: false, error: "STATS_FAILED" } — DB read failed.
 *     Error code is opaque on purpose; the underlying Supabase
 *     message is logged server-side via the count helper.
 *
 * Privacy: this handler MUST never include phone, provider_id,
 * full_name, area, or any other field from the providers /
 * provider_services / provider_areas tables. The e2e spec
 * (e2e/seo/service-foundation.spec.ts) actively asserts the
 * response keys are exactly the four above + does a substring +
 * regex scan for phone-shaped numbers.
 *
 * Caching: dynamic + revalidate=0 — count freshness matters for
 * support / publisher confidence. The underlying DB query is
 * bounded (~1000 rows max per page, chunked .in() afterwards) so
 * the round-trip cost is acceptable for the few queries per minute
 * this endpoint will see during Phase 2.0a (no public callers
 * yet). Phase 2.3+ can layer ISR / snapshot caching when traffic
 * justifies the invalidation complexity.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawSlug = (url.searchParams.get("slug") ?? "").trim();

  const service = getServiceBySlug(rawSlug);
  if (!service) {
    return NextResponse.json(
      { ok: false, error: "INVALID_SLUG" },
      { status: 404 }
    );
  }

  const count = await countActiveProvidersForSlug(service.slug);
  if (count === null) {
    // Underlying Supabase error already logged inside the helper.
    // Do not surface message / details to the public — generic 500.
    return NextResponse.json(
      { ok: false, error: "STATS_FAILED" },
      { status: 500 }
    );
  }

  // Exact response shape — only these four keys. Adding any new
  // field here is a privacy review trigger; see file header.
  return NextResponse.json({
    ok: true,
    category: service.canonical,
    slug: service.slug,
    count,
  });
}
