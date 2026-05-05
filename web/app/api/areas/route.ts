import { NextResponse } from "next/server";
import {
  canonicalizeProviderAreasToCanonicalNames,
  listActiveCanonicalAreas,
} from "@/lib/admin/adminAreaMappings";

const CACHE_TTL_MS = 5 * 60 * 1000;

type AreasCache = {
  expiresAt: number;
  areas: string[];
};

let areasCache: AreasCache | null = null;

async function fetchAllAreas(): Promise<string[]> {
  const now = Date.now();
  if (areasCache && areasCache.expiresAt > now) {
    return areasCache.areas;
  }

  const reconcileResult = await canonicalizeProviderAreasToCanonicalNames();
  if (!reconcileResult.ok) {
    throw new Error(reconcileResult.error);
  }

  const fullAreas = await listActiveCanonicalAreas();

  areasCache = {
    expiresAt: now + CACHE_TTL_MS,
    areas: fullAreas,
  };

  return fullAreas;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const allAreas = await fetchAllAreas();

    const filtered = q
      ? allAreas.filter((area) => {
          const lower = area.toLowerCase();
          return lower.startsWith(q) || lower.includes(q);
        })
      : allAreas;

    // Autocomplete callers (header search) cap to a small dropdown via `q`.
    // List callers (forms — e.g. /i-need/post) ask for the full canonical
    // list with no query and need every active area.
    const limited = q ? filtered.slice(0, 8) : filtered;

    return NextResponse.json({
      ok: true,
      areas: limited,
    });
  } catch (error: any) {
    console.error("[areas API] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to load areas" },
      { status: 500 }
    );
  }
}
