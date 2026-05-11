import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

// GET /api/admin/areas
// Returns regions + canonical areas (each with its currently-active aliases
// bundled) for the admin dashboard's Area accordion. Mirrors the shape of
// /api/admin/categories so AreaTab can use the same mental model as
// CategoryTab.
//
// Sources:
//   service_regions              — region_code, region_name, active
//   service_region_areas         — area_code, canonical_area, region_code, active
//   service_region_area_aliases  — alias_code, alias, canonical_area, region_code, active=true
//
// Join is performed in JS on (lower(canonical_area), region_code) so a
// stray double-space or case drift in a stored value doesn't split an
// area from its aliases. Region name is hydrated from a code→name map.

export const runtime = "nodejs";

const MAX_ROWS = 5000;

type RegionRow = {
  region_code: string;
  region_name: string | null;
  active: boolean | null;
};

type AliasOut = {
  id: string;
  alias_code: string;
  alias: string;
  active: boolean;
  notes: string | null;
};

type AreaOut = {
  area_code: string;
  canonical_area: string;
  region_code: string;
  region_name: string | null;
  active: boolean;
  notes: string | null;
  aliases: AliasOut[];
};

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();
const pairKey = (canonical: unknown, region: unknown) =>
  `${norm(canonical)}||${String(region ?? "")}`;

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const [regionsRes, areasRes, aliasesRes] = await Promise.all([
    adminSupabase
      .from("service_regions")
      .select("region_code, region_name, active")
      .order("region_code", { ascending: true })
      .limit(MAX_ROWS),
    adminSupabase
      .from("service_region_areas")
      .select("area_code, canonical_area, region_code, active, notes")
      .order("region_code", { ascending: true })
      .order("canonical_area", { ascending: true })
      .limit(MAX_ROWS),
    adminSupabase
      .from("service_region_area_aliases")
      .select("id, alias_code, alias, canonical_area, region_code, active, notes")
      .eq("active", true)
      .order("alias", { ascending: true })
      .limit(MAX_ROWS),
  ]);

  if (regionsRes.error || areasRes.error || aliasesRes.error) {
    const err = regionsRes.error || areasRes.error || aliasesRes.error;
    return NextResponse.json(
      {
        ok: false,
        error: "DB_ERROR",
        detail: err?.message,
      },
      { status: 500 }
    );
  }

  // region_code → region_name lookup for hydration.
  const regionNameByCode = new Map<string, string | null>();
  for (const r of (regionsRes.data ?? []) as RegionRow[]) {
    regionNameByCode.set(r.region_code, r.region_name ?? null);
  }

  // Group active aliases by (canonical_area, region_code).
  type AliasRowDb = {
    id: string;
    alias_code: string;
    alias: string | null;
    canonical_area: string | null;
    region_code: string | null;
    active: boolean | null;
    notes: string | null;
  };
  const aliasesByPair = new Map<string, AliasOut[]>();
  for (const row of (aliasesRes.data ?? []) as AliasRowDb[]) {
    const key = pairKey(row.canonical_area, row.region_code);
    const arr = aliasesByPair.get(key) ?? [];
    arr.push({
      id: row.id,
      alias_code: row.alias_code,
      alias: String(row.alias ?? ""),
      active: Boolean(row.active),
      notes: row.notes ?? null,
    });
    aliasesByPair.set(key, arr);
  }

  type AreaRowDb = {
    area_code: string;
    canonical_area: string | null;
    region_code: string | null;
    active: boolean | null;
    notes: string | null;
  };
  const areas: AreaOut[] = ((areasRes.data ?? []) as AreaRowDb[]).map((row) => {
    const region_code = String(row.region_code ?? "");
    const canonical_area = String(row.canonical_area ?? "");
    return {
      area_code: row.area_code,
      canonical_area,
      region_code,
      region_name: regionNameByCode.get(region_code) ?? null,
      active: Boolean(row.active),
      notes: row.notes ?? null,
      aliases: aliasesByPair.get(pairKey(canonical_area, region_code)) ?? [],
    };
  });

  const regions: RegionRow[] = (regionsRes.data ?? []) as RegionRow[];

  return NextResponse.json({ ok: true, regions, areas });
}
