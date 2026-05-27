/**
 * SEO Phase 2.0a — single source of truth for service-landing
 * indexability decisions.
 *
 * Both the (future) /services/[category] page component AND
 * sitemap.ts will consume `getServiceLandingDecision()`. The
 * helper's status return value drives two independent surfaces:
 *
 *   - the page's `metadata.robots` (index/follow vs noindex/nofollow)
 *   - whether the URL appears in the sitemap at all
 *
 * Having ONE function decide makes sitemap drift impossible: a page
 * that renders noindex can never end up in the sitemap, and a URL
 * in the sitemap is guaranteed to render an indexable page.
 *
 * Status matrix:
 *
 *   slug not in allow-list          → notfound
 *   slug valid + DB error           → notfound (FAIL SAFE — better
 *                                     a 404 than a thin 200)
 *   slug valid + providerCount = 0  → notfound (never 200 + empty)
 *   slug valid + 1 ≤ count < 10     → noindex (page renders but
 *                                     metadata blocks indexing AND
 *                                     URL stays out of sitemap)
 *   slug valid + count ≥ 10         → indexable
 *
 * Active-provider definition (deliberately conservative for a
 * public-facing surface — stricter than the admin endpoint's
 * default mode):
 *
 *   - row in `providers`
 *   - `status` = 'active' (case-insensitive trim)
 *   - `verified` = 'yes'  (case-insensitive trim)
 *   - row in `provider_services` matching the canonical category
 *     name via case-insensitive ILIKE
 *
 * Phase 2.0a does NOT cache the count. The query is bounded and
 * cheap; ISR/snapshot caching graduates to Phase 2.3+ when page
 * volume justifies the invalidation complexity. Failing safe to
 * notfound on DB errors means a degraded Supabase will silently
 * 404 the public landing pages — preferred to serving thin pages
 * that Google might index as soft-404 candidates.
 */

import { adminSupabase } from "@/lib/supabase/admin";
import { getServiceBySlug, type AllowedService } from "./slugs";

/** Density threshold for the indexable/noindex split. Single
 * constant so it can be tuned from one place once we have data. */
const INDEX_THRESHOLD = 10;

/**
 * Pagination chunk for the provider_services scan. Supabase's
 * default `range()` cap is 1000; we use the same to stay in one
 * round-trip for most categories.
 */
const PROVIDER_SERVICES_PAGE = 1000;

/**
 * Maximum batch size for the providers `.in()` filter. Splitting
 * the IDs avoids hitting PostgREST query-length limits when a
 * popular category has thousands of matching providers.
 */
const PROVIDERS_IN_CHUNK = 500;

export type LandingDecision =
  | {
      status: "indexable";
      slug: string;
      canonical: string;
      providerCount: number;
    }
  | {
      status: "noindex";
      slug: string;
      canonical: string;
      providerCount: number;
    }
  | { status: "notfound" };

/**
 * Resolve a slug to its landing-page decision.
 *
 * - Unknown slug → `{ status: "notfound" }` immediately (no DB hit).
 * - Known slug   → counts active providers, then maps the count to
 *   the appropriate status per the matrix at the top of this file.
 * - DB error     → `{ status: "notfound" }` (FAIL SAFE).
 */
export async function getServiceLandingDecision(
  slug: string
): Promise<LandingDecision> {
  const service = getServiceBySlug(slug);
  if (!service) return { status: "notfound" };

  const count = await countActiveProvidersForCategory(service);
  if (count === null) {
    // DB error already logged inside the count helper. Fail safe.
    return { status: "notfound" };
  }
  if (count === 0) return { status: "notfound" };
  if (count < INDEX_THRESHOLD) {
    return {
      status: "noindex",
      slug: service.slug,
      canonical: service.canonical,
      providerCount: count,
    };
  }
  return {
    status: "indexable",
    slug: service.slug,
    canonical: service.canonical,
    providerCount: count,
  };
}

/**
 * Convenience wrapper for callers that want only the count (e.g.
 * the public /api/public/category-stats endpoint) without the
 * status mapping. Returns `null` if the slug is unknown or the DB
 * read fails.
 */
export async function countActiveProvidersForSlug(
  slug: string
): Promise<number | null> {
  const service = getServiceBySlug(slug);
  if (!service) return null;
  return countActiveProvidersForCategory(service);
}

// ─── internal ──────────────────────────────────────────────────────

/**
 * Returns the count of providers who:
 *   - have at least one `provider_services` row whose `category`
 *     matches the canonical name (case-insensitive ILIKE), AND
 *   - have `providers.status = 'active'` AND `providers.verified
 *     = 'yes'` (both trimmed + lowercased).
 *
 * Returns `null` on any DB error so the caller can fail safe.
 */
async function countActiveProvidersForCategory(
  service: AllowedService
): Promise<number | null> {
  try {
    // Step 1 — collect provider IDs whose category claim matches.
    // Paginated because provider_services has tens of thousands of
    // rows in aggregate; per-category slices are bounded but better
    // to stay within Supabase's default 1000-row cap explicitly.
    const claimingProviderIds = new Set<string>();
    for (let from = 0; ; from += PROVIDER_SERVICES_PAGE) {
      const { data, error } = await adminSupabase
        .from("provider_services")
        .select("provider_id")
        .ilike("category", service.canonical)
        .range(from, from + PROVIDER_SERVICES_PAGE - 1);
      if (error) {
        console.error(
          "[landingPageData] provider_services read failed",
          { slug: service.slug, code: error.code, message: error.message }
        );
        return null;
      }
      if (!data || data.length === 0) break;
      for (const row of data) {
        const id = String(row.provider_id ?? "").trim();
        if (id) claimingProviderIds.add(id);
      }
      if (data.length < PROVIDER_SERVICES_PAGE) break;
    }

    if (claimingProviderIds.size === 0) return 0;

    // Step 2 — count how many of those IDs satisfy
    // status='active' AND verified='yes'. Chunked .in() to stay
    // under PostgREST query-length limits.
    const ids = Array.from(claimingProviderIds);
    let activeCount = 0;
    for (let i = 0; i < ids.length; i += PROVIDERS_IN_CHUNK) {
      const slice = ids.slice(i, i + PROVIDERS_IN_CHUNK);
      const { data, error } = await adminSupabase
        .from("providers")
        .select("provider_id, status, verified")
        .in("provider_id", slice);
      if (error) {
        console.error(
          "[landingPageData] providers read failed",
          { slug: service.slug, code: error.code, message: error.message }
        );
        return null;
      }
      for (const row of data ?? []) {
        const status = String(row.status ?? "").trim().toLowerCase();
        const verified = String(row.verified ?? "").trim().toLowerCase();
        if (status === "active" && verified === "yes") {
          activeCount += 1;
        }
      }
    }
    return activeCount;
  } catch (err) {
    console.error(
      "[landingPageData] unexpected error",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
