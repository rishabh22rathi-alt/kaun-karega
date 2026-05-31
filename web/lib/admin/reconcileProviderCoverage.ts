import { adminSupabase } from "@/lib/supabase/admin";
import { effectivePlan } from "@/lib/payments/effectivePlan";
import { getPlanRule } from "@/lib/payments/planRules";
import { getDefaultCityCode } from "@/lib/cities/cityContext";

/**
 * Plan B — Provider Coverage Drift Repair.
 *
 * Reconciles provider_areas against the provider's EFFECTIVE plan so the
 * area rows never drift from what the provider is actually entitled to:
 *
 *   - active all_jodhpur  → ensure a row exists for EVERY active JOD region
 *                           (city-wide coverage). Missing regions are filled
 *                           with that region's stable representative canonical
 *                           area (first active area by immutable area_code).
 *   - active regions_5    → trim to at most 5 distinct regions, preferring the
 *                           provider's oldest (originally-chosen) regions.
 *   - free / expired      → trim to exactly 1 region (the oldest). This is the
 *                           guard that stops an EXPIRED all_jodhpur provider
 *                           from retaining 25 regions.
 *
 * provider_areas is AREA-centric: one row per area string, with region_code
 * derived from the area. So "ensure all regions" = ensure >=1 row per active
 * region_code; "trim to N regions" = drop rows whose region_code falls outside
 * the kept set. We never write a synthetic ALL_JODHPUR/JOD-26 region — only
 * real (canonical area, region_code) pairs from the catalog, so the 5-minute
 * canonicalization job leaves the rows (and their region_code) intact.
 *
 * Failure isolation: a single provider's error never aborts the batch. The
 * caller (admin button / activation hook) gets a per-provider tally.
 */

export type CoverageNote = { providerId: string; message: string };

export type ReconcileCoverageResult = {
  ok: boolean;
  checked: number;
  fixed: number;
  warnings: CoverageNote[];
  errors: CoverageNote[];
  // Set only when the batch could not start (catalog/plan scan failed).
  scanError?: { code: string; message: string };
};

type PlanRow = {
  provider_id: string;
  plan_code: string | null;
  max_regions: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
};

type AreaRow = {
  area: string | null;
  city_code: string | null;
  region_code: string | null;
  created_at: string | null;
};

function isCityCode(value: unknown): boolean {
  return /^[A-Z]{3}$/.test(String(value ?? "").trim().toUpperCase());
}

/**
 * Reconcile coverage for one provider (when providerId is supplied) or for
 * every provider that has a provider_plans row (when omitted).
 */
export async function reconcileProviderCoverage(
  providerId?: string
): Promise<ReconcileCoverageResult> {
  const warnings: CoverageNote[] = [];
  const errors: CoverageNote[] = [];
  let checked = 0;
  let fixed = 0;

  // 1. Load plan rows. A provider with no row is the implicit Free plan —
  //    only meaningful to reconcile when explicitly targeted by id.
  let planRows: PlanRow[] = [];
  try {
    let query = adminSupabase
      .from("provider_plans")
      .select(
        "provider_id, plan_code, max_regions, current_period_start, current_period_end"
      );
    if (providerId) query = query.eq("provider_id", providerId);
    const { data, error } = await query;
    if (error) {
      return {
        ok: false,
        checked: 0,
        fixed: 0,
        warnings,
        errors,
        scanError: { code: "PLAN_SCAN_FAILED", message: error.message },
      };
    }
    planRows = (data ?? []) as PlanRow[];
  } catch (err) {
    return {
      ok: false,
      checked: 0,
      fixed: 0,
      warnings,
      errors,
      scanError: {
        code: "PLAN_SCAN_EXCEPTION",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  if (planRows.length === 0) {
    if (providerId) {
      // No row → implicit Free. Reconcile to the 1-region rule.
      planRows = [
        {
          provider_id: providerId,
          plan_code: null,
          max_regions: null,
          current_period_start: null,
          current_period_end: null,
        },
      ];
    } else {
      return { ok: true, checked: 0, fixed: 0, warnings, errors };
    }
  }

  // 2. Load the active region catalog + a STABLE representative area per
  //    region (first active canonical area by immutable area_code). Computed
  //    once for the whole batch.
  const defaultCity = await getDefaultCityCode();

  let activeRegionCodes: string[] = [];
  const repAreaByRegion = new Map<string, string>();
  try {
    const { data: regionRows, error: regionErr } = await adminSupabase
      .from("service_regions")
      .select("region_code, active, city_code")
      .eq("active", true);
    if (regionErr) {
      return {
        ok: false,
        checked: 0,
        fixed: 0,
        warnings,
        errors,
        scanError: { code: "REGION_SCAN_FAILED", message: regionErr.message },
      };
    }
    activeRegionCodes = (regionRows ?? [])
      .filter((r) => {
        const c = String((r as { city_code?: unknown }).city_code ?? "").trim();
        return !c || c.toUpperCase() === defaultCity.toUpperCase();
      })
      .map((r) => String(r.region_code ?? "").trim())
      .filter(Boolean);

    // Order by area_code ascending so the chosen representative is stable and
    // deterministic — it does not shift when a new (alphabetically earlier)
    // area is later added to the region.
    const { data: sraRows, error: sraErr } = await adminSupabase
      .from("service_region_areas")
      .select("area_code, canonical_area, region_code, city_code, active")
      .eq("active", true)
      .order("area_code", { ascending: true });
    if (sraErr) {
      return {
        ok: false,
        checked: 0,
        fixed: 0,
        warnings,
        errors,
        scanError: { code: "AREA_CATALOG_SCAN_FAILED", message: sraErr.message },
      };
    }
    for (const r of sraRows ?? []) {
      const c = String((r as { city_code?: unknown }).city_code ?? "").trim();
      if (c && c.toUpperCase() !== defaultCity.toUpperCase()) continue;
      const rc = String(r.region_code ?? "").trim();
      const ca = String(r.canonical_area ?? "").trim();
      if (rc && ca && !repAreaByRegion.has(rc)) repAreaByRegion.set(rc, ca);
    }
  } catch (err) {
    return {
      ok: false,
      checked: 0,
      fixed: 0,
      warnings,
      errors,
      scanError: {
        code: "CATALOG_SCAN_EXCEPTION",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }

  // 3. Per-provider reconcile. One provider's failure never aborts the batch.
  for (const plan of planRows) {
    const pid = String(plan.provider_id || "").trim();
    if (!pid) continue;
    checked += 1;
    try {
      const eff = effectivePlan(plan);
      // effectivePlan already collapses an expired paid plan to code 'free'.
      const rule = getPlanRule(eff.code);

      const { data: areaData, error: areaErr } = await adminSupabase
        .from("provider_areas")
        .select("area, city_code, region_code, created_at")
        .eq("provider_id", pid);
      if (areaErr) {
        errors.push({ providerId: pid, message: `areas read: ${areaErr.message}` });
        continue;
      }
      const areas = (areaData ?? []) as AreaRow[];
      const cityCode =
        areas.find((a) => isCityCode(a.city_code))?.city_code?.trim() ||
        defaultCity;

      if (rule.kind === "cityWide") {
        // Ensure a row exists for every active region.
        const present = new Set(
          areas.map((a) => String(a.region_code ?? "").trim()).filter(Boolean)
        );
        const missing = activeRegionCodes.filter((rc) => !present.has(rc));
        if (missing.length === 0) continue;

        const toInsert: Array<{
          provider_id: string;
          area: string;
          city_code: string;
          region_code: string;
        }> = [];
        const noRep: string[] = [];
        for (const rc of missing) {
          const rep = repAreaByRegion.get(rc);
          if (!rep) {
            noRep.push(rc);
            continue;
          }
          toInsert.push({
            provider_id: pid,
            area: rep,
            city_code: cityCode,
            region_code: rc,
          });
        }

        if (toInsert.length > 0) {
          const { error: insErr } = await adminSupabase
            .from("provider_areas")
            .insert(toInsert);
          if (insErr) {
            errors.push({ providerId: pid, message: `coverage insert: ${insErr.message}` });
            continue;
          }
          fixed += 1;
        }
        if (noRep.length > 0) {
          warnings.push({
            providerId: pid,
            message: `all_jodhpur: ${noRep.length} active region(s) have no representative area (${noRep.join(", ")})`,
          });
        }
        continue;
      }

      // Fixed-cap plans: free/expired → 1, regions_5 → 5.
      const cap = rule.maxRegions;

      if (areas.length === 0) {
        // Do not guess a region for an empty provider — flag for admin.
        warnings.push({
          providerId: pid,
          message: `${eff.code}: provider has no coverage rows; assign a region manually`,
        });
        continue;
      }

      // Distinct non-null regions, oldest first (created_at, then area for a
      // deterministic tiebreak when the Phase-1 backfill gave equal timestamps).
      const sorted = [...areas].sort((a, b) => {
        const ta = Date.parse(a.created_at ?? "") || 0;
        const tb = Date.parse(b.created_at ?? "") || 0;
        if (ta !== tb) return ta - tb;
        return String(a.area ?? "").localeCompare(String(b.area ?? ""));
      });
      const distinct: string[] = [];
      for (const a of sorted) {
        const rc = String(a.region_code ?? "").trim();
        if (rc && !distinct.includes(rc)) distinct.push(rc);
      }

      if (distinct.length <= cap) continue;

      const dropRegions = distinct.slice(cap);
      const { error: delErr } = await adminSupabase
        .from("provider_areas")
        .delete()
        .eq("provider_id", pid)
        .in("region_code", dropRegions);
      if (delErr) {
        errors.push({ providerId: pid, message: `trim delete: ${delErr.message}` });
        continue;
      }
      fixed += 1;
    } catch (err) {
      errors.push({
        providerId: pid,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { ok: true, checked, fixed, warnings, errors };
}
