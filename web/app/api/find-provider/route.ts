import { createClient } from "@/lib/supabase/server";
import { canonicalizeProviderAreasToCanonicalNames } from "@/lib/admin/adminAreaMappings";

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

  const category = clean(
    (typeof body.category === "string" ? body.category : queryCategory) ||
      queryService
  );
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

    const { data: serviceRows, error: servicesError } = await supabase
      .from("provider_services")
      .select("provider_id, category")
      .eq("category", category)
      .limit(200);

    if (servicesError) {
      throw new Error(servicesError.message || "Unable to load provider services.");
    }

    const { data: areaRows, error: areasError } = await supabase
      .from("provider_areas")
      .select("provider_id, area")
      .eq("area", area)
      .limit(200);

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

    const matchedProviderIds = [...serviceProviderIds]
      .filter((providerId) => areaProviderIds.has(providerId))
      .slice(0, safeLimit);

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
      }));
      try {
        const { error: matchesError } = await supabase
          .from("provider_task_matches")
          .upsert(matchRows, { onConflict: "task_id,provider_id", ignoreDuplicates: true });

        if (matchesError) {
          console.warn(
            "[find-provider] unable to store provider_task_matches",
            matchesError.message || matchesError
          );
        }
      } catch (error) {
        console.warn("[find-provider] provider_task_matches insert failed", error);
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
