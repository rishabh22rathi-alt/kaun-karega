import { adminSupabase } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Sandbox-only public region listing for the provider register/edit UI.
// Returns each active region with its active canonical areas attached
// so the page can render a region picker without a follow-up roundtrip.
// Read-only, no auth — same anonymous posture as /api/area-intelligence/
// {resolve,suggest}. Does not touch live matching, provider registration,
// /api/find-provider, /api/areas, or homepage logic.

export const runtime = "nodejs";

const MAX_ROWS = 5000;

type RegionRowDb = {
  region_code: string;
  region_name: string | null;
  active: boolean | null;
};

type AreaRowDb = {
  canonical_area: string | null;
  region_code: string | null;
  active: boolean | null;
};

export async function GET() {
  try {
    const [regionsRes, areasRes] = await Promise.all([
      adminSupabase
        .from("service_regions")
        .select("region_code, region_name, active")
        .eq("active", true)
        .order("region_code", { ascending: true })
        .limit(MAX_ROWS),
      adminSupabase
        .from("service_region_areas")
        .select("canonical_area, region_code, active")
        .eq("active", true)
        .order("canonical_area", { ascending: true })
        .limit(MAX_ROWS),
    ]);

    if (regionsRes.error || areasRes.error) {
      console.error(
        "[area-intelligence/regions] db error",
        regionsRes.error || areasRes.error
      );
      return NextResponse.json(
        { ok: false, error: "DB_ERROR" },
        { status: 500 }
      );
    }

    const areasByRegion = new Map<string, string[]>();
    for (const row of (areasRes.data ?? []) as AreaRowDb[]) {
      const rc = String(row.region_code ?? "");
      const name = String(row.canonical_area ?? "").trim();
      if (!rc || !name) continue;
      const arr = areasByRegion.get(rc) ?? [];
      arr.push(name);
      areasByRegion.set(rc, arr);
    }

    const regions = ((regionsRes.data ?? []) as RegionRowDb[]).map((r) => ({
      region_code: r.region_code,
      region_name: String(r.region_name ?? ""),
      areas: areasByRegion.get(r.region_code) ?? [],
    }));

    return NextResponse.json({ ok: true, regions });
  } catch (err: any) {
    console.error("[area-intelligence/regions] unexpected", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
