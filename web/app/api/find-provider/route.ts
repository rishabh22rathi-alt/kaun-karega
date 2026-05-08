import { createClient } from "@/lib/supabase/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { getAuthSession } from "@/lib/auth";
import { canonicalizeProviderAreasToCanonicalNames } from "@/lib/admin/adminAreaMappings";
// CHANGE: import alias resolver so user-typed variants ("lohar", "welding")
// map to canonical category ("welder") before downstream matching.
// Detail-aware variant lets us pick up the alias the user typed (e.g.
// "dentist" -> doctor) and use it as the work_tag filter against
// provider_work_terms when no explicit workTag was passed.
import { resolveCategoryAliasDetailed } from "@/lib/categoryAliases";

export const runtime = "nodejs";

const clean = (s: string) => (s || "").trim().replace(/\s+/g, " ");

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

/**
 * Determine whether the caller is authenticated as the owner of `taskId`.
 *
 * Privacy contract:
 *   - Returns true ONLY when the signed `kk_auth_session` cookie is valid
 *     AND `tasks.phone` for the given taskId equals the verified session
 *     phone (10-digit normalised).
 *   - Returns false for any other case (no session, no taskId, missing
 *     task, mismatched owner, transient DB error). The caller treats
 *     `false` as "public/anon view" and emits only masked phones.
 *   - Body fields (`userPhone`, etc.) are intentionally NOT consulted —
 *     ownership comes only from the signed cookie + the DB row.
 */
async function verifyTaskOwnership(
  cookieHeader: string,
  taskId: string
): Promise<boolean> {
  if (!taskId) return false;
  const session = await getAuthSession({ cookie: cookieHeader });
  const sessionPhone10 = normalizePhone10(session?.phone);
  if (!session || sessionPhone10.length !== 10) return false;
  const { data: taskRow, error } = await adminSupabase
    .from("tasks")
    .select("phone")
    .eq("task_id", taskId)
    .maybeSingle();
  if (error || !taskRow) return false;
  const taskPhone10 = normalizePhone10(taskRow.phone);
  return taskPhone10.length === 10 && taskPhone10 === sessionPhone10;
}

async function handle(req: Request) {
  const url = new URL(req.url);
  const queryCategory = clean(url.searchParams.get("category") || "");
  const queryService = clean(url.searchParams.get("service") || "");
  const queryArea = clean(url.searchParams.get("area") || "");
  const queryTaskId = clean(url.searchParams.get("taskId") || "");
  const queryUserPhone = clean(url.searchParams.get("userPhone") || "");
  const queryLimit = clean(url.searchParams.get("limit") || "20");

  let body: Record<string, unknown> = {};
  if (req.method === "POST") {
    try {
      body = (await req.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
  }

  // CHANGE: resolve aliases (lohar → welder, etc.) before matching.
  // Falls through to the original cleaned input if no alias row matches.
  // Detail-aware so the matched alias becomes the work_tag filter when
  // the caller didn't pass one explicitly.
  const rawCategory = clean(
    (typeof body.category === "string" ? body.category : queryCategory) ||
      queryService
  );
  const { canonical: category, matchedAlias } =
    await resolveCategoryAliasDetailed(rawCategory);
  // Explicit workTag from caller wins; otherwise the alias the resolver
  // matched becomes the implicit specialization filter. Empty string =
  // no specialization filter (broad category+area only, today's behaviour).
  const explicitWorkTag = clean(
    (typeof body.workTag === "string"
      ? body.workTag
      : url.searchParams.get("workTag") || "") || ""
  );
  const workTag = explicitWorkTag || matchedAlias || "";
  const area = clean(
    (typeof body.area === "string" ? body.area : queryArea) || ""
  );
  const taskId = clean(
    (typeof body.taskId === "string" ? body.taskId : queryTaskId) || ""
  );
  const userPhone = clean(
    (typeof body.userPhone === "string" ? body.userPhone : queryUserPhone) || ""
  );
  const limit = Number(
    clean((typeof body.limit === "string" ? body.limit : queryLimit) || "20")
  );

  const inBody = {
    category,
    workTag,
    area,
    taskId,
    userPhone,
    limit: Math.min(Number.isFinite(limit) ? limit : 20, 50),
  };
  console.log("MATCH_API_IN", body && Object.keys(body).length ? body : inBody);

  try {
    const reconcileResult = await canonicalizeProviderAreasToCanonicalNames();
    if (!reconcileResult.ok) {
      throw new Error(reconcileResult.error || "Unable to reconcile provider areas.");
    }

    const supabase = await createClient();
    const safeLimit = Math.min(Number.isFinite(limit) ? limit : 20, 50);

    // Privileged path: only when the caller's signed session phone owns
    // the supplied taskId do we include raw provider phone numbers in
    // the response. Public browsing (no taskId, anonymous, or unrelated
    // task) sees masked phones only — preserves A6 against directory
    // scraping.
    const ownerVerified = await verifyTaskOwnership(
      req.headers.get("cookie") ?? "",
      taskId
    );

    // Gate: only return matches when the requested category exists in the
    // master `categories` table with active = true. Mirrors the gate in
    // process-task-notifications. Fail-open on Supabase error: log and
    // continue, so a transient DB blip does not silently drop results.
    //
    // Case-insensitive: a task or UI input of "Plumbing" must still match a
    // canonical row of "plumbing". `.ilike("name", category)` does the job
    // without requiring a Postgres trigger. `.maybeSingle()` is fine because
    // the categories.name column already has a uniqueness constraint
    // (case-insensitive duplicates are not expected).
    const { data: categoryRow, error: categoryError } = await supabase
      .from("categories")
      .select("name")
      .ilike("name", category)
      .eq("active", true)
      .maybeSingle();

    if (categoryError) {
      console.warn(
        "[find-provider] category active-check failed; failing open",
        categoryError.message || categoryError
      );
    } else if (!categoryRow) {
      return Response.json(
        {
          ok: true,
          count: 0,
          providers: [],
          matchTier: "category",
          usedFallback: false,
        },
        { status: 200 }
      );
    }

    // Use the canonical category name (and area) for downstream lookups so
    // every join key is the same casing regardless of how the request was
    // typed. Falls back to the raw input if the categories row was skipped
    // (transient DB error → fail-open path above).
    const canonicalCategory = String(categoryRow?.name || category);

    const { data: serviceRows, error: servicesError } = await supabase
      .from("provider_services")
      .select("provider_id, category")
      .ilike("category", canonicalCategory)
      .limit(5000);

    if (servicesError) {
      throw new Error(servicesError.message || "Unable to load provider services.");
    }

    const { data: areaRows, error: areasError } = await supabase
      .from("provider_areas")
      .select("provider_id, area")
      .ilike("area", area)
      .limit(5000);

    if (areasError) {
      throw new Error(areasError.message || "Unable to load provider areas.");
    }

    const serviceProviderIds = new Set(
      Array.isArray(serviceRows)
        ? serviceRows.map((row) => String(row.provider_id || "").trim()).filter(Boolean)
        : []
    );
    const areaProviderIds = new Set(
      Array.isArray(areaRows)
        ? areaRows.map((row) => String(row.provider_id || "").trim()).filter(Boolean)
        : []
    );

    // Optional third-axis filter: providers who have claimed the requested
    // alias under the same canonical category in provider_work_terms.
    // Only fires when workTag is non-empty. Fail-open on lookup error: log
    // and continue with broad two-way intersection so a transient DB blip
    // never starves matching of results.
    let workTermProviderIds: Set<string> | null = null;
    if (workTag) {
      const { data: workTermRows, error: workTermsError } = await supabase
        .from("provider_work_terms")
        .select("provider_id")
        .ilike("alias", workTag)
        .ilike("canonical_category", canonicalCategory)
        .limit(5000);
      if (workTermsError) {
        console.warn(
          "[find-provider] provider_work_terms lookup failed; falling back to broad",
          workTermsError.message || workTermsError
        );
      } else {
        workTermProviderIds = new Set(
          (workTermRows ?? [])
            .map((row) => String(row.provider_id || "").trim())
            .filter(Boolean)
        );
      }
    }

    const broadMatched = [...serviceProviderIds]
      .filter((providerId) => areaProviderIds.has(providerId))
      .sort();

    // Tier resolution:
    //   - workTag + work_terms lookup ok + exact > 0 → "work_tag"
    //   - workTag (lookup ok or errored) + exact = 0 → "category_fallback"
    //   - no workTag → "category"
    let allMatchedProviderIds: string[];
    let matchTier: "work_tag" | "category_fallback" | "category";
    let usedFallback: boolean;
    if (workTag && workTermProviderIds !== null) {
      const exactMatched = broadMatched.filter((id) =>
        workTermProviderIds!.has(id)
      );
      if (exactMatched.length > 0) {
        allMatchedProviderIds = exactMatched;
        matchTier = "work_tag";
        usedFallback = false;
      } else {
        allMatchedProviderIds = broadMatched;
        matchTier = "category_fallback";
        usedFallback = true;
      }
    } else if (workTag) {
      // Lookup errored — best-effort fallback to broad.
      allMatchedProviderIds = broadMatched;
      matchTier = "category_fallback";
      usedFallback = true;
    } else {
      allMatchedProviderIds = broadMatched;
      matchTier = "category";
      usedFallback = false;
    }

    const matchedProviderIds = taskId
      ? allMatchedProviderIds
      : allMatchedProviderIds.slice(0, safeLimit);

    if (matchedProviderIds.length === 0) {
      return Response.json(
        {
          ok: true,
          count: 0,
          providers: [],
          matchTier,
          usedFallback,
        },
        { status: 200 }
      );
    }

    const { data: providers, error: providersError } = await supabase
      .from("providers")
      .select("provider_id, full_name, phone, verified, status")
      .in("provider_id", matchedProviderIds);

    if (providersError) {
      throw new Error(providersError.message || "Unable to load providers.");
    }

    // Mask raw phone numbers so the public response cannot be used to
    // harvest the provider directory. Internal matching above still uses
    // `providers.phone` to populate `provider_task_matches`; the WhatsApp
    // notification path (`/api/process-task-notifications`) re-reads the
    // raw phone server-side at send time, so the user-facing handoff is
    // unaffected.
    const maskPhone10 = (value: string): string => {
      const digits = String(value || "").replace(/\D/g, "").slice(-10);
      if (digits.length !== 10) return "";
      return `${digits.slice(0, 2)}XXXXXX${digits.slice(-2)}`;
    };

    type ProviderListItem = {
      ProviderID: string;
      name: string;
      phoneMasked: string;
      // Present ONLY when ownerVerified is true (caller is signed-in task
      // owner). Absent on every public/anon path — preserves A6.
      phone?: string;
      category: string;
      area: string;
      verified: string;
    };

    const providersList: ProviderListItem[] = Array.isArray(providers)
      ? matchedProviderIds
          .map((providerId): ProviderListItem | null => {
            const provider = providers.find((item) => String(item.provider_id || "").trim() === providerId);
            if (!provider) return null;
            if (String(provider.status || "").trim().toLowerCase() === "blocked") return null;
            const rawPhone10 = normalizePhone10(provider.phone);
            const item: ProviderListItem = {
              ProviderID: String(provider.provider_id || "").trim(),
              name: String(provider.full_name || "").trim(),
              phoneMasked: maskPhone10(String(provider.phone || "")),
              category,
              area,
              verified: String(provider.verified || "").trim(),
            };
            // Privileged disclosure: only the signed-in task owner can see
            // the raw 10-digit phone. Everyone else sees `phoneMasked`
            // alone, never `phone`.
            if (ownerVerified && rawPhone10.length === 10) {
              item.phone = rawPhone10;
            }
            return item;
          })
          .filter((provider): provider is ProviderListItem => Boolean(provider))
      : [];

    if (taskId && providersList.length > 0) {
      const matchRows = providersList.map((provider) => ({
        task_id: taskId,
        provider_id: provider.ProviderID,
        category,
        area,
        match_status: "matched",
      }));

      const { error: matchesError } = await supabase
        .from("provider_task_matches")
        .upsert(matchRows, { onConflict: "task_id,provider_id" });

      if (matchesError) {
        return Response.json(
          {
            ok: false,
            error: matchesError.message,
            providers: providersList,
            count: providersList.length,
            matchTier,
            usedFallback,
          },
          { status: 502 }
        );
      }
    }

    return Response.json(
      {
        ok: true,
        count: providersList.length,
        providers: providersList,
        matchTier,
        usedFallback,
      },
      { status: 200 }
    );
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error:
          error instanceof Error ? error.message : "Unable to fetch matched providers.",
        providers: [],
        count: 0,
        matchTier: "category",
        usedFallback: false,
      },
      { status: 502 }
    );
  }
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}
