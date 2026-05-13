import { adminSupabase } from "../supabase/admin";

/**
 * Provider-centric review aggregator.
 *
 * Three sources unioned by provider_id:
 *
 *   1. `pending_category_requests` where `status='pending'` and a
 *      `provider_id` is set. Each row represents a provider asking for
 *      a brand-new canonical service category. Approve/reject flows
 *      through the existing /api/kk admin actions; we touch no
 *      lifecycle here.
 *
 *   2. `category_aliases` where `active=false` and
 *      `submitted_by_provider_id IS NOT NULL`. These are provider-
 *      submitted custom work terms awaiting admin approval. Admin-
 *      initiated rows (NULL submitter) are deliberately excluded from
 *      the per-provider view because they aren't tied to a single
 *      provider's profile.
 *
 *   3. `area_review_queue` where `status='pending'` and `source_type`
 *      is `provider_register` or `provider_update`. The provider id
 *      lives in `source_ref`. Non-provider rows (e.g. legacy / admin-
 *      seeded queue entries) stay in the AreaTab governance surface.
 *
 * The helper performs no mutations and does not approve, reject, or
 * resolve anything. It is a read aggregator for the Providers Under
 * Review / Approval tile. The existing approve/reject endpoints
 * (`approve_category_request`, `reject_category_request`,
 * `/api/admin/aliases`, `admin_map_unmapped_area`,
 * `admin_resolve_unmapped_area`) remain the only path that changes
 * lifecycle state.
 */

export type PendingCategoryItem = {
  kind: "category";
  requestId: string;
  requestedCategory: string;
  createdAt: string | null;
};

export type PendingWorkTermItem = {
  kind: "alias";
  alias: string;
  canonicalCategory: string;
  aliasType: string | null;
  createdAt: string | null;
};

export type PendingAreaItem = {
  kind: "area";
  reviewId: string;
  rawArea: string;
  sourceType: string;
  createdAt: string | null;
};

export type ProviderReviewGroup = {
  providerId: string;
  providerName: string;
  phone: string;
  // Reflects the *underlying* verified eligibility (phone + active
  // service category) — i.e. what `verified` would equal if this
  // provider had no open review items. The new tile excludes under-
  // review providers from the verified count, so this flag is for
  // the UI's "current verified status" label only.
  eligibleVerified: boolean;
  pendingCategories: PendingCategoryItem[];
  pendingWorkTerms: PendingWorkTermItem[];
  pendingAreas: PendingAreaItem[];
};

export type ProvidersUnderReviewResult = {
  providers: ProviderReviewGroup[];
  // Fast-lookup set of every provider_id with at least one open item.
  // The /api/admin/provider-stats endpoint consumes this to compute
  // the verified count fresh with the exclusion applied.
  providerIdSet: Set<string>;
};

type CategoryRequestRow = {
  request_id: string | null;
  provider_id: string | null;
  requested_category: string | null;
  status: string | null;
  created_at: string | null;
};

type AliasRow = {
  alias: string | null;
  canonical_category: string | null;
  alias_type: string | null;
  active: boolean | null;
  submitted_by_provider_id: string | null;
  created_at: string | null;
};

type AreaReviewRow = {
  review_id: string | null;
  raw_area: string | null;
  source_type: string | null;
  source_ref: string | null;
  status: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

type ProviderRow = {
  provider_id: string | null;
  full_name: string | null;
  phone: string | null;
};

type ProfilePhoneRow = { phone: string | null };
type CategoryNameRow = { name: string | null; active: boolean | null };
type ServiceRow = { provider_id: string | null; category: string | null };

function s(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizePhone10(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

function normalizeCategoryKey(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const VERIFIED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PROVIDER_AREA_SOURCE_TYPES = new Set([
  "provider_register",
  "provider_update",
]);

/**
 * Compute the per-provider eligible-verified set using the SAME
 * predicates as /api/admin/provider-stats:
 *   - phone matches a `profiles` row with `last_login_at` within 30d
 *   - provider has at least one `provider_services` row whose
 *     normalized category is in `categories.active=true`
 *
 * Mirroring the rule here (rather than calling the stats endpoint
 * back) keeps the helper self-contained and lets the stats route
 * import this helper without circular cost.
 */
async function computeVerifiedProviderIds(
  providerIds: string[],
  providerPhonesByIdRaw: Map<string, string>
): Promise<Set<string>> {
  const out = new Set<string>();
  if (providerIds.length === 0) return out;

  const sinceIso = new Date(Date.now() - VERIFIED_WINDOW_MS).toISOString();

  const [profilesRes, categoriesRes, servicesRes] = await Promise.all([
    adminSupabase
      .from("profiles")
      .select("phone")
      .gte("last_login_at", sinceIso)
      .limit(5000),
    adminSupabase.from("categories").select("name, active").eq("active", true),
    adminSupabase
      .from("provider_services")
      .select("provider_id, category")
      .in("provider_id", providerIds),
  ]);

  if (profilesRes.error || categoriesRes.error || servicesRes.error) {
    // Soft-degrade: if any source fails we return an empty set, which
    // means none of the under-review providers will be flagged as
    // "currently verified". The Under Review tile still works.
    return out;
  }

  const recentPhones = new Set<string>();
  for (const row of (profilesRes.data ?? []) as ProfilePhoneRow[]) {
    const phone = normalizePhone10(row.phone);
    if (phone.length === 10) recentPhones.add(phone);
  }
  const activeCategories = new Set<string>();
  for (const row of (categoriesRes.data ?? []) as CategoryNameRow[]) {
    const key = normalizeCategoryKey(row.name);
    if (key) activeCategories.add(key);
  }
  const providersWithActiveService = new Set<string>();
  for (const row of (servicesRes.data ?? []) as ServiceRow[]) {
    const id = s(row.provider_id);
    if (!id) continue;
    const key = normalizeCategoryKey(row.category);
    if (key && activeCategories.has(key)) providersWithActiveService.add(id);
  }

  for (const id of providerIds) {
    const phone = normalizePhone10(providerPhonesByIdRaw.get(id) ?? "");
    if (phone.length !== 10) continue;
    if (!recentPhones.has(phone)) continue;
    if (!providersWithActiveService.has(id)) continue;
    out.add(id);
  }
  return out;
}

export async function buildProvidersUnderReview(): Promise<ProvidersUnderReviewResult> {
  // Three parallel reads — kept narrow so we never pull row payloads
  // we won't surface in the response.
  const [categoryReqRes, aliasRes, areaRes] = await Promise.all([
    adminSupabase
      .from("pending_category_requests")
      .select("request_id, provider_id, requested_category, status, created_at")
      .eq("status", "pending")
      .not("provider_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(500),
    adminSupabase
      .from("category_aliases")
      .select(
        "alias, canonical_category, alias_type, active, submitted_by_provider_id, created_at"
      )
      .eq("active", false)
      .not("submitted_by_provider_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(500),
    adminSupabase
      .from("area_review_queue")
      .select(
        "review_id, raw_area, source_type, source_ref, status, first_seen_at, last_seen_at"
      )
      .eq("status", "pending")
      .in("source_type", Array.from(PROVIDER_AREA_SOURCE_TYPES))
      .order("first_seen_at", { ascending: false })
      .limit(500),
  ]);

  const categoryRows = ((categoryReqRes.data ?? []) as CategoryRequestRow[]) || [];
  const aliasRows = ((aliasRes.data ?? []) as AliasRow[]) || [];
  const areaRows = ((areaRes.data ?? []) as AreaReviewRow[]) || [];

  // Per-provider bucketing.
  const groups = new Map<string, ProviderReviewGroup>();
  const ensureGroup = (providerId: string): ProviderReviewGroup => {
    let g = groups.get(providerId);
    if (!g) {
      g = {
        providerId,
        providerName: "",
        phone: "",
        eligibleVerified: false,
        pendingCategories: [],
        pendingWorkTerms: [],
        pendingAreas: [],
      };
      groups.set(providerId, g);
    }
    return g;
  };

  for (const row of categoryRows) {
    const pid = s(row.provider_id);
    if (!pid) continue;
    ensureGroup(pid).pendingCategories.push({
      kind: "category",
      requestId: s(row.request_id),
      requestedCategory: s(row.requested_category),
      createdAt: row.created_at ?? null,
    });
  }
  for (const row of aliasRows) {
    const pid = s(row.submitted_by_provider_id);
    if (!pid) continue;
    ensureGroup(pid).pendingWorkTerms.push({
      kind: "alias",
      alias: s(row.alias),
      canonicalCategory: s(row.canonical_category),
      aliasType: row.alias_type ?? null,
      createdAt: row.created_at ?? null,
    });
  }
  for (const row of areaRows) {
    const pid = s(row.source_ref);
    if (!pid) continue;
    ensureGroup(pid).pendingAreas.push({
      kind: "area",
      reviewId: s(row.review_id),
      rawArea: s(row.raw_area),
      sourceType: s(row.source_type),
      // area_review_queue uses first_seen_at as the closest analog to
      // created_at — last_seen_at advances every time the same raw
      // area is queued again, so the first_seen value is the right
      // ordering signal for "when did this start needing review".
      createdAt: row.first_seen_at ?? row.last_seen_at ?? null,
    });
  }

  const providerIds = Array.from(groups.keys());
  if (providerIds.length === 0) {
    return { providers: [], providerIdSet: new Set() };
  }

  // Enrich with provider name / phone via one batched lookup.
  const { data: providerRows, error: providerErr } = await adminSupabase
    .from("providers")
    .select("provider_id, full_name, phone")
    .in("provider_id", providerIds);
  const providerPhonesById = new Map<string, string>();
  if (!providerErr) {
    for (const row of (providerRows ?? []) as ProviderRow[]) {
      const pid = s(row.provider_id);
      if (!pid) continue;
      const g = groups.get(pid);
      if (!g) continue;
      g.providerName = s(row.full_name);
      g.phone = s(row.phone);
      providerPhonesById.set(pid, s(row.phone));
    }
  }

  // Eligible-verified annotation. Mirrors the provider-stats predicates
  // so the UI label matches what /api/admin/provider-stats counts.
  const verifiedIds = await computeVerifiedProviderIds(
    providerIds,
    providerPhonesById
  );
  for (const [pid, g] of groups) {
    g.eligibleVerified = verifiedIds.has(pid);
  }

  // Sort providers by total pending count (desc) so the noisiest cases
  // sort to the top. Ties broken by provider name to keep ordering
  // stable across refreshes.
  const providers = Array.from(groups.values()).sort((a, b) => {
    const aTotal =
      a.pendingCategories.length +
      a.pendingWorkTerms.length +
      a.pendingAreas.length;
    const bTotal =
      b.pendingCategories.length +
      b.pendingWorkTerms.length +
      b.pendingAreas.length;
    if (bTotal !== aTotal) return bTotal - aTotal;
    return a.providerName.localeCompare(b.providerName);
  });

  return {
    providers,
    providerIdSet: new Set(providerIds),
  };
}
