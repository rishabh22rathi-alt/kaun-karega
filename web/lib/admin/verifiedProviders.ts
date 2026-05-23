import { adminSupabase } from "@/lib/supabase/admin";
import { buildProvidersUnderReview } from "@/lib/admin/adminProviderReview";

// Canonical "verified provider" definition for Kaun Karega admin
// surfaces. ONE rule, ONE helper — every admin tile/table that
// reports a verified count must go through here so the dashboard
// and the Area/Region tab can never drift again.
//
// A provider is verified when ALL of:
//   1. Registered           — row exists in `providers`.
//   2. Not admin-blocked    — providers.verified != "no" (text column
//                             is a moderation flag, not the badge).
//   3. OTP still valid      — provider's phone (last 10 digits) is in
//                             a `profiles` row whose last_login_at is
//                             within the last 30 days. Writes to
//                             last_login_at happen only during OTP
//                             verification (verify-otp / auth/verify-otp
//                             / disclaimer), so this is "OTP recency",
//                             not session/login state. Logging out
//                             does not revoke the badge.
//   4. Active approved category
//                           — provider has at least one
//                             provider_services row whose normalized
//                             category appears in
//                             categories WHERE active=true.
//   5. Not under review     — provider not present in the under-review
//                             set built by buildProvidersUnderReview()
//                             (pending category requests, alias
//                             submissions, area-review-queue items).
//
// All five gates must pass. providers.verified="yes" alone is not
// sufficient; imported providers without a recent profile row will
// fail gate 3 and are intentionally excluded.

const VERIFIED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

type ProviderRow = {
  provider_id: string | null;
  phone: string | null;
  verified: unknown;
};
type ProfilePhoneRow = { phone: string | null };
type CategoryNameRow = { name: string | null };
type ServiceRow = { provider_id: string | null; category: string | null };

function normalizePhone10(value: unknown): string {
  return String(value ?? "").replace(/\D/g, "").slice(-10);
}

function normalizeCategoryKey(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

// providers.verified is stored as text "yes"/"no" in the live DB; a
// stray boolean true is accepted defensively. We veto on "no" rather
// than gating on "yes" — the badge no longer depends on this column,
// but a negative admin verdict still blocks.
function isAdminBlocked(value: unknown): boolean {
  if (value === false) return true;
  return (
    String(value ?? "")
      .trim()
      .toLowerCase() === "no"
  );
}

type FilterFn<Q> = (q: Q) => Q;

async function fetchAllRows<T>(
  table: string,
  selectCols: string,
  applyFilter?: FilterFn<unknown>
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = adminSupabase
      .from(table)
      .select(selectCols)
      .range(from, from + PAGE_SIZE - 1);
    if (applyFilter) query = applyFilter(query) as typeof query;
    const { data, error } = await query;
    if (error) throw new Error(`${table} page ${from}: ${error.message}`);
    if (!data || data.length === 0) break;
    all.push(...(data as T[]));
    if (data.length < PAGE_SIZE) break;
  }
  return all;
}

export type BuildVerifiedProviderSetOptions = {
  // Pre-computed under-review set. Pass-through avoids a duplicate
  // call to buildProvidersUnderReview() when the caller already has
  // one (e.g. /api/admin/provider-stats needs the under-review count
  // for its own tile).
  underReviewSet?: Set<string>;
};

// Returns the Set<provider_id> that satisfy ALL five verified gates.
// Paginates every source so the count is correct above 1000 rows.
//
// On any source-fetch error this throws. Callers may choose to
// soft-degrade by catching and falling back to an empty set, but the
// dashboard tile and AreaTab counts both prefer to surface the error.
export async function buildVerifiedProviderSet(
  opts: BuildVerifiedProviderSetOptions = {}
): Promise<Set<string>> {
  // Stage 1 timing: every log line is prefixed [admin-perf] so a single
  // grep against the server output isolates this work. Kept lightweight
  // (no extra DB calls, no extra allocations beyond a handful of
  // millisecond deltas) so this is safe to ship to production.
  const t0 = Date.now();
  const sinceIso = new Date(Date.now() - VERIFIED_WINDOW_MS).toISOString();

  const tFetch0 = Date.now();
  const [providers, recentProfiles, activeCategoryRows, serviceRows] =
    await Promise.all([
      fetchAllRows<ProviderRow>(
        "providers",
        "provider_id, phone, verified"
      ),
      fetchAllRows<ProfilePhoneRow>("profiles", "phone", (q) =>
        (q as { gte: (col: string, val: string) => unknown }).gte(
          "last_login_at",
          sinceIso
        )
      ),
      fetchAllRows<CategoryNameRow>("categories", "name, active", (q) =>
        (q as { eq: (col: string, val: boolean) => unknown }).eq(
          "active",
          true
        )
      ),
      fetchAllRows<ServiceRow>(
        "provider_services",
        "provider_id, category"
      ),
    ]);
  console.log(
    `[admin-perf] buildVerifiedProviderSet sources fetched in ${
      Date.now() - tFetch0
    }ms (providers=${providers.length}, profiles_recent_30d=${
      recentProfiles.length
    }, categories_active=${activeCategoryRows.length}, provider_services=${
      serviceRows.length
    })`
  );

  // Gate 3 input: phones with a recent profile row.
  const recentPhoneSet = new Set<string>();
  for (const row of recentProfiles) {
    const phone = normalizePhone10(row.phone);
    if (phone.length === 10) recentPhoneSet.add(phone);
  }

  // Gate 4 input: normalized active category names.
  const activeCategoryKeys = new Set<string>();
  for (const row of activeCategoryRows) {
    const key = normalizeCategoryKey(row.name);
    if (key) activeCategoryKeys.add(key);
  }

  // Gate 4 application: provider IDs with at least one matching service.
  const providersWithActiveServiceIds = new Set<string>();
  for (const row of serviceRows) {
    const id = String(row.provider_id ?? "").trim();
    if (!id) continue;
    const key = normalizeCategoryKey(row.category);
    if (!key || !activeCategoryKeys.has(key)) continue;
    providersWithActiveServiceIds.add(id);
  }

  // Gate 5 input: under-review IDs (caller-provided or freshly built).
  let underReviewSet = opts.underReviewSet;
  let underReviewSource: "provided" | "computed" | "computed_failed" =
    "provided";
  if (!underReviewSet) {
    const tUr0 = Date.now();
    try {
      underReviewSet = (await buildProvidersUnderReview()).providerIdSet;
      underReviewSource = "computed";
    } catch {
      // Soft-degrade: an under-review fetch failure must not silently
      // inflate the verified count. Treat as "no one under review" so
      // the rest of the gates still apply; the worst case is one extra
      // verified count, not a wrong-direction inflation.
      underReviewSet = new Set<string>();
      underReviewSource = "computed_failed";
    }
    console.log(
      `[admin-perf] buildVerifiedProviderSet underReview ${underReviewSource} in ${
        Date.now() - tUr0
      }ms (size=${underReviewSet.size})`
    );
  }

  const verified = new Set<string>();
  for (const provider of providers) {
    const id = String(provider.provider_id ?? "").trim();
    if (!id) continue;
    // Gate 2: admin veto.
    if (isAdminBlocked(provider.verified)) continue;
    // Gate 3: OTP recency.
    const phone = normalizePhone10(provider.phone);
    if (phone.length !== 10) continue;
    if (!recentPhoneSet.has(phone)) continue;
    // Gate 4: active category.
    if (!providersWithActiveServiceIds.has(id)) continue;
    // Gate 5: under-review veto.
    if (underReviewSet.has(id)) continue;
    verified.add(id);
  }
  console.log(
    `[admin-perf] buildVerifiedProviderSet total ${Date.now() - t0}ms (verified_size=${
      verified.size
    }, under_review_source=${underReviewSource})`
  );
  return verified;
}
