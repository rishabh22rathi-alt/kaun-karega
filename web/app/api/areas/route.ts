import { NextResponse } from "next/server";

const CACHE_TTL_MS = 5 * 60 * 1000;

type AreasCache = {
  expiresAt: number;
  areas: string[];
};

let areasCache: AreasCache | null = null;

function resolveAppsScriptUrl(): string {
  return (process.env.APPS_SCRIPT_URL || "").trim();
}

async function fetchAllAreas(): Promise<string[]> {
  const now = Date.now();
  if (areasCache && areasCache.expiresAt > now) {
    return areasCache.areas;
  }

  const scriptUrl = resolveAppsScriptUrl();
  if (!scriptUrl) {
    throw new Error("Missing Apps Script URL");
  }

  const url = new URL(scriptUrl);
  url.searchParams.set("action", "get_areas");

  const response = await fetch(url.toString(), { cache: "no-store" });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Apps Script error (${response.status}): ${text}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Apps Script returned non-JSON for get_areas");
  }

  const fullAreas = Array.isArray(parsed?.areas)
    ? parsed.areas
        .filter((value: unknown) => typeof value === "string")
        .map((value: string) => value.trim())
        .filter(Boolean)
    : [];

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

    return NextResponse.json({
      ok: true,
      areas: filtered.slice(0, 8),
    });
  } catch (error: any) {
    console.error("[areas API] error", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to load areas" },
      { status: 500 }
    );
  }
}
