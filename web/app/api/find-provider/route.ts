import { createClient } from "@/lib/supabase/server";
import { canonicalizeProviderAreasToCanonicalNames } from "@/lib/admin/adminAreaMappings";
// CHANGE: import alias resolver so user-typed variants ("lohar", "welding")
// map to canonical category ("welder") before downstream matching.
import { resolveCategoryAlias } from "@/lib/categoryAliases";

const clean = (s: string) => (s || "").trim().replace(/\s+/g, " ");

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
  const rawCategory = clean(
    (typeof body.category === "string" ? body.category : queryCategory) ||
      queryService
  );
  const category = await resolveCategoryAlias(rawCategory);
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

    const allMatchedProviderIds = [...serviceProviderIds]
      .filter((providerId) => areaProviderIds.has(providerId))
      .sort();

    const matchedProviderIds = taskId
      ? allMatchedProviderIds
      : allMatchedProviderIds.slice(0, safeLimit);

    if (matchedProviderIds.length === 0) {
      return Response.json(
        {
          ok: true,
          count: 0,
          providers: [],
          usedFallback: false,
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

    const providersList = Array.isArray(providers)
      ? matchedProviderIds
          .map((providerId) => {
            const provider = providers.find((item) => String(item.provider_id || "").trim() === providerId);
            if (!provider) return null;
            if (String(provider.status || "").trim().toLowerCase() === "blocked") return null;
            return {
              ProviderID: String(provider.provider_id || "").trim(),
              name: String(provider.full_name || "").trim(),
              phone: String(provider.phone || "").trim(),
              category,
              area,
              verified: String(provider.verified || "").trim(),
            };
          })
          .filter((provider): provider is {
            ProviderID: string;
            name: string;
            phone: string;
            category: string;
            area: string;
            verified: string;
          } => Boolean(provider))
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
            usedFallback: false,
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
        usedFallback: false,
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
