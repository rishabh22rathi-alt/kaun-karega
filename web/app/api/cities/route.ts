import { NextResponse } from "next/server";
import { adminSupabase } from "@/lib/supabase/admin";
import { getDefaultCityCode } from "@/lib/cities/cityContext";

// Phase 1.1 — public city catalogue. Same posture as
// /api/area-intelligence/regions: read-only, no auth, returns only the
// active subset. Drives the (future) homepage CitySelector and lets any
// client discover the canonical default without hardcoding "JOD".
//
// Response shape is additive-only and stable:
//   { ok, cities: [{ city_code, city_name, state, country, is_default }],
//     default_city_code }
// Internal columns (active, notes, timestamps) are not surfaced — the
// public set already implies active=true, and notes is an admin-only
// concept.

export const runtime = "nodejs";

const CACHE_TTL_MS = 5 * 60 * 1000;

type CityOut = {
  city_code: string;
  city_name: string;
  state: string;
  country: string;
  is_default: boolean;
};

type Cache = {
  expiresAt: number;
  cities: CityOut[];
  defaultCityCode: string;
};

let cache: Cache | null = null;

export async function GET() {
  try {
    const now = Date.now();
    if (cache && cache.expiresAt > now) {
      return NextResponse.json({
        ok: true,
        cities: cache.cities,
        default_city_code: cache.defaultCityCode,
      });
    }

    // Default-city resolution goes through the shared helper so the
    // value matches whatever every other Phase 1.1 endpoint sees, even
    // if their caches expire at different moments.
    const defaultCityCode = await getDefaultCityCode();

    const { data, error } = await adminSupabase
      .from("cities")
      .select("city_code, city_name, state, country, is_default")
      .eq("active", true)
      .order("is_default", { ascending: false })
      .order("city_name", { ascending: true })
      .limit(100);

    if (error) {
      console.error("[api/cities] db error", error);
      return NextResponse.json(
        { ok: false, error: "DB_ERROR" },
        { status: 500 }
      );
    }

    const cities: CityOut[] = ((data ?? []) as Array<{
      city_code: string | null;
      city_name: string | null;
      state: string | null;
      country: string | null;
      is_default: boolean | null;
    }>).map((r) => ({
      city_code: String(r.city_code ?? ""),
      city_name: String(r.city_name ?? ""),
      state: String(r.state ?? ""),
      country: String(r.country ?? ""),
      is_default: Boolean(r.is_default),
    }));

    cache = {
      expiresAt: now + CACHE_TTL_MS,
      cities,
      defaultCityCode,
    };

    return NextResponse.json({
      ok: true,
      cities,
      default_city_code: defaultCityCode,
    });
  } catch (err) {
    console.error("[api/cities] unexpected", err);
    const message = err instanceof Error ? err.message : "Unexpected error";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 500 }
    );
  }
}
