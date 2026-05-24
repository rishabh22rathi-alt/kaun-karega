import { NextResponse } from "next/server";
import {
  InvalidCityCodeError,
  resolveCityParam,
} from "@/lib/cities/cityContext";
import { resolveAreasToRegions } from "@/lib/geo/areaRegionResolver";
import { adminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const GOOGLE_GEOCODING_URL =
  "https://maps.googleapis.com/maps/api/geocode/json";
const NO_CONFIDENT_MATCH = {
  ok: false,
  error: "NO_CONFIDENT_MATCH",
  message: "We could not confidently detect your area. Please type manually.",
} as const;

type DetectBody = {
  cityCode?: unknown;
  latitude?: unknown;
  longitude?: unknown;
};

type GoogleAddressComponent = {
  long_name?: string;
  short_name?: string;
  types?: string[];
};

type GoogleGeocodeResult = {
  formatted_address?: string;
  address_components?: GoogleAddressComponent[];
};

type GoogleGeocodeResponse = {
  status?: string;
  results?: GoogleGeocodeResult[];
};

type ReverseGeocodeResult = {
  areaCandidates: string[];
  cityCandidates: string[];
  source: "reverse_geocode";
};

type ResolvedDetection = {
  detectedArea: string;
  regionCode: string;
  regionName: string;
  matchType: "canonical" | "alias" | "region";
};

function isValidLatitude(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -90 &&
    value <= 90
  );
}

function isValidLongitude(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= -180 &&
    value <= 180
  );
}

function normalizeCityCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function toAreaKey(value: unknown): string {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pushUnique(target: string[], value: unknown): void {
  const text = normalizeText(value);
  if (!text) return;
  const key = text.toLowerCase();
  if (target.some((existing) => existing.toLowerCase() === key)) return;
  target.push(text);
}

function isNonProductionTestHookAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

function googleFixtureFromRequest(request: Request): GoogleGeocodeResponse | null {
  if (!isNonProductionTestHookAllowed()) return null;
  const raw = request.headers.get("x-kk-google-geocode-fixture");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as GoogleGeocodeResponse)
      : null;
  } catch {
    return null;
  }
}

function geocoderDisabledByRequest(request: Request): boolean {
  return (
    isNonProductionTestHookAllowed() &&
    request.headers.get("x-kk-disable-geocoder") === "1"
  );
}

async function reverseGeocodeTemporarily(
  latitude: number,
  longitude: number,
  request: Request
): Promise<ReverseGeocodeResult | null> {
  const fixture = googleFixtureFromRequest(request);
  const raw = fixture ?? (await fetchGoogleGeocode(latitude, longitude));
  if (!raw || raw.status !== "OK" || !Array.isArray(raw.results)) {
    return null;
  }

  const areaCandidates: string[] = [];
  const cityCandidates: string[] = [];
  const areaTypes = new Set([
    "sublocality_level_1",
    "sublocality_level_2",
    "neighborhood",
    "route",
  ]);
  const cityTypes = new Set(["locality", "postal_town"]);

  for (const result of raw.results.slice(0, 3)) {
    for (const component of result.address_components ?? []) {
      const types = component.types ?? [];
      if (types.some((type) => areaTypes.has(type))) {
        pushUnique(areaCandidates, component.long_name);
        pushUnique(areaCandidates, component.short_name);
      }
      if (types.some((type) => cityTypes.has(type))) {
        pushUnique(cityCandidates, component.long_name);
        pushUnique(cityCandidates, component.short_name);
      }
    }
  }

  return { areaCandidates, cityCandidates, source: "reverse_geocode" };
}

async function fetchGoogleGeocode(
  latitude: number,
  longitude: number
): Promise<GoogleGeocodeResponse | null> {
  const key = process.env.GOOGLE_GEOCODING_API_KEY?.trim();
  if (!key) return null;

  const url = new URL(GOOGLE_GEOCODING_URL);
  url.searchParams.set("latlng", `${latitude},${longitude}`);
  url.searchParams.set("key", key);
  url.searchParams.set("result_type", "sublocality|neighborhood|route|locality");

  try {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as GoogleGeocodeResponse;
  } catch {
    return null;
  }
}

async function fetchCityName(cityCode: string): Promise<string> {
  const { data } = await adminSupabase
    .from("cities")
    .select("city_name")
    .eq("city_code", cityCode)
    .maybeSingle();
  return normalizeText((data as { city_name?: unknown } | null)?.city_name);
}

function isCityMismatch(
  cityCode: string,
  selectedCityName: string,
  detectedCities: string[]
): boolean {
  if (detectedCities.length === 0) return false;
  const allowed = new Set([toAreaKey(cityCode), toAreaKey(selectedCityName)]);
  return !detectedCities.some((city) => allowed.has(toAreaKey(city)));
}

async function regionNameFor(regionCode: string): Promise<string> {
  const { data } = await adminSupabase
    .from("service_regions")
    .select("region_name")
    .eq("region_code", regionCode)
    .maybeSingle();
  return normalizeText((data as { region_name?: unknown } | null)?.region_name);
}

async function resolveRegionCandidate(
  candidate: string,
  cityCode: string
): Promise<ResolvedDetection | null> {
  const normalizedCandidate = toAreaKey(candidate);
  if (!normalizedCandidate) return null;

  const { data, error } = await adminSupabase
    .from("service_regions")
    .select("region_code, region_name")
    .eq("active", true)
    .eq("city_code", cityCode)
    .limit(1000);
  if (error) return null;

  for (const row of (data ?? []) as Array<{
    region_code: string | null;
    region_name: string | null;
  }>) {
    const regionName = normalizeText(row.region_name);
    const regionCode = normalizeText(row.region_code);
    if (!regionName || !regionCode) continue;
    if (toAreaKey(regionName) === normalizedCandidate) {
      return {
        detectedArea: regionName,
        regionCode,
        regionName,
        matchType: "region",
      };
    }
  }

  return null;
}

async function resolveDetectedArea(
  candidates: string[],
  cityCode: string
): Promise<ResolvedDetection | null> {
  const cleaned = candidates.map(normalizeText).filter(Boolean);
  if (cleaned.length === 0) return null;

  const resolved = await resolveAreasToRegions(adminSupabase, {
    areas: cleaned,
    cityCode,
  });

  for (const candidate of cleaned) {
    const match = resolved.get(candidate);
    if (match?.resolved) {
      return {
        detectedArea: match.canonical_area,
        regionCode: match.region_code,
        regionName: (await regionNameFor(match.region_code)) || match.canonical_area,
        matchType: match.match_type,
      };
    }
  }

  for (const candidate of cleaned) {
    const regionMatch = await resolveRegionCandidate(candidate, cityCode);
    if (regionMatch) return regionMatch;
  }

  return null;
}

export async function POST(request: Request) {
  let body: DetectBody;
  try {
    body = (await request.json()) as DetectBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "INVALID_JSON", message: "Invalid request body." },
      { status: 400 }
    );
  }

  const cityCode = normalizeCityCode(body.cityCode);
  if (!/^[A-Z]{3}$/.test(cityCode)) {
    return NextResponse.json(
      { ok: false, error: "INVALID_CITY_CODE", message: "Invalid city." },
      { status: 400 }
    );
  }

  if (!isValidLatitude(body.latitude) || !isValidLongitude(body.longitude)) {
    return NextResponse.json(
      {
        ok: false,
        error: "INVALID_COORDINATES",
        message: "Invalid location coordinates.",
      },
      { status: 400 }
    );
  }

  try {
    await resolveCityParam(
      new URL(`https://kaunkarega.local/?city=${cityCode}`),
      { fallback: "reject" }
    );
  } catch (error) {
    if (error instanceof InvalidCityCodeError) {
      return NextResponse.json(
        { ok: false, error: "INVALID_CITY_CODE", message: "Invalid city." },
        { status: 400 }
      );
    }
    return NextResponse.json(
      {
        ok: false,
        error: "CITY_LOOKUP_FAILED",
        message: "Could not verify city.",
      },
      { status: 500 }
    );
  }

  if (
    geocoderDisabledByRequest(request) ||
    (!process.env.GOOGLE_GEOCODING_API_KEY?.trim() &&
      !googleFixtureFromRequest(request))
  ) {
    return NextResponse.json({ ...NO_CONFIDENT_MATCH, cityCode });
  }

  const geocode = await reverseGeocodeTemporarily(
    body.latitude,
    body.longitude,
    request
  );

  if (!geocode || geocode.areaCandidates.length === 0) {
    return NextResponse.json({ ...NO_CONFIDENT_MATCH, cityCode });
  }

  const selectedCityName = await fetchCityName(cityCode);
  if (isCityMismatch(cityCode, selectedCityName, geocode.cityCandidates)) {
    return NextResponse.json({
      ok: false,
      error: "CITY_MISMATCH",
      cityCode,
      message:
        "Detected location seems outside the selected city. Please type your area manually.",
    });
  }

  const detected = await resolveDetectedArea(geocode.areaCandidates, cityCode);
  if (!detected) {
    return NextResponse.json({ ...NO_CONFIDENT_MATCH, cityCode });
  }

  return NextResponse.json({
    ok: true,
    detectedArea: detected.detectedArea,
    regionCode: detected.regionCode,
    regionName: detected.regionName,
    cityCode,
    confidence: "approximate",
    source: geocode.source,
    message: `You seem near ${detected.detectedArea}`,
  });
}
