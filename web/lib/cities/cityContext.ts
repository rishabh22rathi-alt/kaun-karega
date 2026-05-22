import { adminSupabase } from "@/lib/supabase/admin";

// Phase 1.1 — single source of truth for `?city=` resolution and the
// default-city lookup. Every city-aware read API funnels through here so
// the default never has to be hardcoded. The day a second city is seeded
// no caller needs editing.
//
// Posture
//   • Reads only. No writes, no side effects.
//   • Two short-TTL in-process caches: one for the default city code, one
//     for the active-city Set. Both rebuild lazily on cache miss and on
//     promotion failure (e.g. the cities table is briefly unreachable).
//   • Throws on a malformed configuration (zero or multiple active default
//     rows) — the partial unique index in 20260527120000_cities_init.sql
//     enforces ≤1, so the impossible case still gets a loud error rather
//     than a silent fallback.
//
// Format invariant
//   city_code is ^[A-Z]{3}$ — same CHECK constraint as the cities table.
//   resolveCityParam upper-cases input before validating so callers can
//   accept ?city=jod or ?city=JOD interchangeably.

const CACHE_TTL_MS = 5 * 60 * 1000;
const CITY_CODE_FORMAT = /^[A-Z]{3}$/;

type DefaultCityCache = {
  expiresAt: number;
  cityCode: string;
};

type ActiveCitiesCache = {
  expiresAt: number;
  codes: Set<string>;
};

let defaultCityCache: DefaultCityCache | null = null;
let activeCitiesCache: ActiveCitiesCache | null = null;

export type ResolveCityResult = {
  city_code: string;
  // True when no ?city= was provided and we fell back to the default. Lets
  // callers log/telemeter the fallback without needing to re-parse the URL.
  was_default: boolean;
};

export class CityConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CityConfigError";
  }
}

export class InvalidCityCodeError extends Error {
  // Carries the offending input so call sites can echo it back in the 400
  // response without re-parsing the URL.
  public readonly input: string;
  constructor(input: string, message: string) {
    super(message);
    this.name = "InvalidCityCodeError";
    this.input = input;
  }
}

// Returns the city_code of the single active default row. Throws if the
// invariant is violated (zero default rows or DB read failure).
//
// Short-TTL cache: cities is tiny and edited infrequently. 5 min keeps
// the hot path off the DB without ever serving stale-by-more-than-five-
// minutes data, which is fine for a config table.
export async function getDefaultCityCode(): Promise<string> {
  const now = Date.now();
  if (defaultCityCache && defaultCityCache.expiresAt > now) {
    return defaultCityCache.cityCode;
  }

  const { data, error } = await adminSupabase
    .from("cities")
    .select("city_code")
    .eq("is_default", true)
    .eq("active", true)
    .limit(2);

  if (error) {
    throw new CityConfigError(
      `Failed to read default city: ${error.message}`
    );
  }
  const rows = (data ?? []) as Array<{ city_code: string | null }>;
  if (rows.length === 0) {
    throw new CityConfigError(
      "No active default city configured (expected exactly one row in cities with is_default=true AND active=true)."
    );
  }
  if (rows.length > 1) {
    // Should be unreachable: partial unique index in
    // 20260527120000_cities_init.sql guarantees ≤1 row with
    // is_default=true. Still defended in code in case the index is
    // dropped or replaced.
    throw new CityConfigError(
      "Multiple active default cities found — cities_one_default_idx invariant violated."
    );
  }
  const cityCode = String(rows[0].city_code ?? "").trim();
  if (!CITY_CODE_FORMAT.test(cityCode)) {
    throw new CityConfigError(
      `Default city_code "${cityCode}" does not match ^[A-Z]{3}$.`
    );
  }

  defaultCityCache = { expiresAt: now + CACHE_TTL_MS, cityCode };
  return cityCode;
}

// Returns the Set of active city codes. Used to validate ?city= input —
// a well-formed but unknown code is treated as "not active right now".
export async function listActiveCityCodes(): Promise<Set<string>> {
  const now = Date.now();
  if (activeCitiesCache && activeCitiesCache.expiresAt > now) {
    return activeCitiesCache.codes;
  }

  const { data, error } = await adminSupabase
    .from("cities")
    .select("city_code")
    .eq("active", true)
    .limit(100);

  if (error) {
    throw new CityConfigError(
      `Failed to read active cities: ${error.message}`
    );
  }
  const codes = new Set<string>();
  for (const row of (data ?? []) as Array<{ city_code: string | null }>) {
    const c = String(row.city_code ?? "").trim();
    if (CITY_CODE_FORMAT.test(c)) codes.add(c);
  }

  activeCitiesCache = { expiresAt: now + CACHE_TTL_MS, codes };
  return codes;
}

export type ResolveCityOpts = {
  // "default"  — missing/blank ?city= falls back to the default city.
  //              Malformed or inactive ?city= ALSO falls back to default
  //              when this mode is selected (autocomplete-style: never
  //              break the UX on a bad param).
  // "reject"   — missing/blank still falls back to default, but malformed
  //              or inactive ?city= throws InvalidCityCodeError. The
  //              endpoint converts the throw to a 400 response.
  fallback: "default" | "reject";
};

// Parses ?city= from a URL, normalizes to upper-case, validates format
// and active-city membership. Returns the resolved code and whether the
// caller fell back to default.
//
// Missing ?city= ALWAYS falls back to default — this preserves
// old-client behavior exactly (Phase 1.1 hard requirement).
export async function resolveCityParam(
  url: URL,
  opts: ResolveCityOpts = { fallback: "reject" }
): Promise<ResolveCityResult> {
  const raw = url.searchParams.get("city");
  const trimmed = (raw ?? "").trim();

  if (trimmed.length === 0) {
    const cityCode = await getDefaultCityCode();
    return { city_code: cityCode, was_default: true };
  }

  const upper = trimmed.toUpperCase();
  if (!CITY_CODE_FORMAT.test(upper)) {
    if (opts.fallback === "default") {
      const cityCode = await getDefaultCityCode();
      return { city_code: cityCode, was_default: true };
    }
    throw new InvalidCityCodeError(
      trimmed,
      `Invalid city_code "${trimmed}". Expected three upper-case ASCII letters.`
    );
  }

  const active = await listActiveCityCodes();
  if (!active.has(upper)) {
    if (opts.fallback === "default") {
      const cityCode = await getDefaultCityCode();
      return { city_code: cityCode, was_default: true };
    }
    throw new InvalidCityCodeError(
      trimmed,
      `city_code "${upper}" is not active.`
    );
  }

  return { city_code: upper, was_default: false };
}

// Phase 1.2 — write-path preservation. Used by every runtime insert/rewrite
// site to satisfy a single rule: if the row we are replacing already had a
// city_code, keep it; otherwise fall back to the configured default.
//
// Why a dedicated helper instead of `existing ?? await getDefaultCityCode()`
// at every call site: the rewrite loops in adminAreaMappings.ts may touch
// thousands of rows. Centralising the trim + format check here keeps every
// preservation site honest — a row whose city_code is "" or "  " or
// otherwise malformed gets the same fallback treatment as a truly NULL one,
// instead of being written back literally and tripping the format CHECK
// constraint at a later phase.
export async function preserveOrDefaultCityCode(
  existing: string | null | undefined
): Promise<string> {
  const trimmed = String(existing ?? "").trim();
  if (CITY_CODE_FORMAT.test(trimmed)) return trimmed;
  return getDefaultCityCode();
}

// Test/dev escape hatch: discards both caches so a test that seeds a new
// default city sees it without waiting on the TTL. Not exported through
// any API surface; only test imports need it.
export function __resetCityCachesForTests(): void {
  defaultCityCache = null;
  activeCitiesCache = null;
}
