import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import { canonicalizeProviderAreasToCanonicalNames } from "@/lib/admin/adminAreaMappings";

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizePhone10(raw: unknown): string {
  return String(raw || "")
    .replace(/\D/g, "")
    .slice(-10);
}

async function gasPost(action: string, params: Record<string, unknown> = {}): Promise<any> {
  if (!APPS_SCRIPT_URL) throw new Error("APPS_SCRIPT_URL is not configured");

  console.log("GAS CALL:", action);

  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ action, ...params }),
  });

  if (!res.ok) {
    console.log("GAS ERROR:", res.status);
    throw new Error(`GAS request failed with status ${res.status}`);
  }

  return res.json();
}

async function deleteProviderRows(providerId: string): Promise<void> {
  await Promise.all([
    adminSupabase.from("provider_services").delete().eq("provider_id", providerId),
    adminSupabase.from("provider_areas").delete().eq("provider_id", providerId),
    adminSupabase.from("providers").delete().eq("provider_id", providerId),
  ]);
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  console.log("STEP 1: Starting migration");

  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    console.log("AUTH FAILED");
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Parse batch params from body (fall back to defaults)
    const body = await request.json().catch(() => ({}));
    const startIndex = Math.max(0, Number(body.startIndex) || 0);
    const limit = Math.max(1, Math.min(100, Number(body.limit) || 25));

    console.log("STEP 2: Calling admin_get_providers");

    const providersPayload = await gasPost("admin_get_providers");

    console.log("STEP 3: GAS response received");

    if (!providersPayload.ok || !Array.isArray(providersPayload.providers)) {
      console.log("STEP 3 FAILED:", providersPayload);
      return NextResponse.json(
        { ok: false, error: "Invalid GAS payload" },
        { status: 502 }
      );
    }

    const allGasProviders = providersPayload.providers;
    const total = allGasProviders.length;
    const batch = allGasProviders.slice(startIndex, startIndex + limit);
    const processed = batch.length;

    console.log("BATCH:", { total, startIndex, limit, processed });

    const { data: existingRows, error: existingError } = await adminSupabase
      .from("providers")
      .select("phone, provider_id");

    if (existingError) {
      console.log("STEP 4 FAILED: existing phones", existingError.message);
      return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 });
    }

    const existingPhones = new Set(
      (existingRows ?? [])
        .map((r) => normalizePhone10(r.phone))
        .filter((p) => p.length === 10)
    );

    const existingProviderIds = new Set(
      (existingRows ?? [])
        .map((r) => String(r.provider_id || "").trim())
        .filter(Boolean)
    );

    console.log("STEP 5: Existing phones loaded =", existingPhones.size);

    let insertedProviders = 0;
    let skippedDuplicates = 0;
    let skippedInvalidPhone = 0;
    let skippedProfileFetchFailed = 0;
    let skippedInsertFailed = 0;
    let servicesInserted = 0;
    let areasInserted = 0;

    for (const gasProv of batch) {
      const providerId = String(gasProv.ProviderID || "").trim();
      const phone10 = normalizePhone10(gasProv.Phone);

      if (!providerId || phone10.length !== 10) {
        skippedInvalidPhone++;
        continue;
      }

      if (existingPhones.has(phone10) || existingProviderIds.has(providerId)) {
        skippedDuplicates++;
        continue;
      }

      const { error: provError } = await adminSupabase.from("providers").insert({
        provider_id: providerId,
        full_name: gasProv.ProviderName,
        phone: phone10,
        status: "active",
        verified: gasProv.Verified === "yes" ? "yes" : "no",
      });

      if (provError) {
        console.log("Provider insert error:", provError.message);
        skippedInsertFailed++;
        continue;
      }

      existingPhones.add(phone10);
      existingProviderIds.add(providerId);

      console.log("STEP 6: Fetching profile for", phone10);

      let profile;
      try {
        profile = await gasPost("get_provider_profile", { phone: phone10 });
      } catch {
        console.log("Profile fetch failed");
        await deleteProviderRows(providerId);
        skippedProfileFetchFailed++;
        continue;
      }

      const services = profile?.provider?.Services || [];
      const areas = profile?.provider?.Areas || [];

      const serviceRows = [...new Set(services.map((s: any) => s.Category))]
        .filter(Boolean)
        .map((category) => ({
          provider_id: providerId,
          category: category as string,
        }));

      if (serviceRows.length) {
        const { error } = await adminSupabase.from("provider_services").insert(serviceRows);
        if (error) {
          await deleteProviderRows(providerId);
          skippedInsertFailed++;
          continue;
        }
        servicesInserted += serviceRows.length;
      }

      const areaRows = [...new Set(areas.map((a: any) => a.Area))]
        .filter(Boolean)
        .map((area) => ({
          provider_id: providerId,
          area: area as string,
        }));

      if (areaRows.length) {
        const { error } = await adminSupabase.from("provider_areas").insert(areaRows);
        if (error) {
          await deleteProviderRows(providerId);
          skippedInsertFailed++;
          continue;
        }
        areasInserted += areaRows.length;
      }

      insertedProviders++;
    }

    console.log("STEP 7: Running canonicalization");

    await canonicalizeProviderAreasToCanonicalNames({ force: true });

    console.log("STEP 8: Migration complete");

    const nextStartIndex = startIndex + processed;

    return NextResponse.json({
      ok: true,
      total_gas_providers: total,
      start_index: startIndex,
      limit,
      processed_count: processed,
      next_start_index: nextStartIndex,
      has_more: nextStartIndex < total,
      inserted_providers: insertedProviders,
      skipped_duplicates: skippedDuplicates,
      skipped_invalid_phone: skippedInvalidPhone,
      skipped_profile_fetch_failed: skippedProfileFetchFailed,
      skipped_insert_failed: skippedInsertFailed,
      services_inserted: servicesInserted,
      areas_inserted: areasInserted,
    });

  } catch (err: any) {
    console.log("FATAL ERROR:", err.message);
    return NextResponse.json({ ok: false, error: err.message }, { status: 500 });
  }
}