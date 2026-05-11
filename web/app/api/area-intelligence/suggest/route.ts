import { adminSupabase } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Sandbox-only suggestion endpoint for Area Intelligence.
// Does NOT touch live matching, provider registration, homepage search,
// /api/find-provider, /api/areas, existing area_aliases logic, or the
// admin editor. Read-only — no DB writes.
//
// GET /api/area-intelligence/suggest?query=<text>
//   - minimum query length 2 (else 200 with empty array)
//   - case-insensitive substring against alias / canonical_area /
//     region_name
//   - active=true only
//   - merge order: aliases → canonical_areas → regions
//   - dedupe by (label + region_code), preserving first occurrence
//   - cap at 10

export const runtime = "nodejs";

const MAX_SUGGESTIONS = 10;
// Per-table fetch cap before JS dedupe/merge. Larger than the response
// cap so dedupe collisions don't accidentally starve later sources.
const PER_TABLE_CAP = 50;

// ILIKE treats % and _ as wildcards; escape them so a stray underscore
// in the user's typing doesn't become a wildcard.
const escapeIlike = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");

type Suggestion = {
  type: "alias" | "canonical_area" | "region";
  label: string;
  canonical_area: string | null;
  region_code: string;
  region_name: string;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = url.searchParams.get("query") || "";
  const q = raw.trim().toLowerCase();

  // Minimum length guard. Empty response, not an error — keeps autocomplete
  // call sites simple (they always render the array).
  if (q.length < 2) {
    return NextResponse.json({ ok: true, query: raw, suggestions: [] });
  }

  const pattern = `%${escapeIlike(q)}%`;

  try {
    const [aliasesRes, areasRes, regionsRes] = await Promise.all([
      adminSupabase
        .from("service_region_area_aliases")
        .select("alias, canonical_area, region_code")
        .eq("active", true)
        .ilike("alias", pattern)
        .order("alias", { ascending: true })
        .limit(PER_TABLE_CAP),
      adminSupabase
        .from("service_region_areas")
        .select("canonical_area, region_code")
        .eq("active", true)
        .ilike("canonical_area", pattern)
        .order("canonical_area", { ascending: true })
        .limit(PER_TABLE_CAP),
      adminSupabase
        .from("service_regions")
        .select("region_code, region_name")
        .eq("active", true)
        .ilike("region_name", pattern)
        .order("region_name", { ascending: true })
        .limit(PER_TABLE_CAP),
    ]);

    if (aliasesRes.error || areasRes.error || regionsRes.error) {
      const err =
        aliasesRes.error || areasRes.error || regionsRes.error;
      console.error("[area-intelligence/suggest] db error", err);
      return NextResponse.json(
        { ok: false, query: raw, error: "DB_ERROR" },
        { status: 500 }
      );
    }

    // Build region_code → region_name map. Pull every active region once;
    // small set (≤ a few dozen), so the round-trip is cheap and keeps the
    // alias/canonical sources from needing per-row joins.
    const { data: allRegions, error: regionsAllErr } = await adminSupabase
      .from("service_regions")
      .select("region_code, region_name")
      .eq("active", true)
      .limit(1000);
    if (regionsAllErr) {
      console.error(
        "[area-intelligence/suggest] regions map fetch failed",
        regionsAllErr
      );
      return NextResponse.json(
        { ok: false, query: raw, error: "DB_ERROR" },
        { status: 500 }
      );
    }
    const regionNameByCode = new Map<string, string>();
    for (const r of allRegions ?? []) {
      if (r.region_code) {
        regionNameByCode.set(r.region_code, r.region_name ?? "");
      }
    }

    const suggestions: Suggestion[] = [];
    const seen = new Set<string>();
    const dedupeKey = (label: string, region_code: string) =>
      `${label.toLowerCase()}||${region_code}`;

    // 1) Aliases first.
    for (const row of aliasesRes.data ?? []) {
      const label = String(row.alias ?? "").trim();
      const region_code = String(row.region_code ?? "").trim();
      if (!label || !region_code) continue;
      const key = dedupeKey(label, region_code);
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({
        type: "alias",
        label,
        canonical_area: String(row.canonical_area ?? "") || null,
        region_code,
        region_name: regionNameByCode.get(region_code) ?? "",
      });
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }

    // 2) Canonical areas.
    if (suggestions.length < MAX_SUGGESTIONS) {
      for (const row of areasRes.data ?? []) {
        const label = String(row.canonical_area ?? "").trim();
        const region_code = String(row.region_code ?? "").trim();
        if (!label || !region_code) continue;
        const key = dedupeKey(label, region_code);
        if (seen.has(key)) continue;
        seen.add(key);
        suggestions.push({
          type: "canonical_area",
          label,
          canonical_area: label,
          region_code,
          region_name: regionNameByCode.get(region_code) ?? "",
        });
        if (suggestions.length >= MAX_SUGGESTIONS) break;
      }
    }

    // 3) Regions.
    if (suggestions.length < MAX_SUGGESTIONS) {
      for (const row of regionsRes.data ?? []) {
        const label = String(row.region_name ?? "").trim();
        const region_code = String(row.region_code ?? "").trim();
        if (!label || !region_code) continue;
        const key = dedupeKey(label, region_code);
        if (seen.has(key)) continue;
        seen.add(key);
        suggestions.push({
          type: "region",
          label,
          canonical_area: null,
          region_code,
          region_name: label,
        });
        if (suggestions.length >= MAX_SUGGESTIONS) break;
      }
    }

    return NextResponse.json({ ok: true, query: raw, suggestions });
  } catch (err: any) {
    console.error("[area-intelligence/suggest] unexpected", err);
    return NextResponse.json(
      { ok: false, query: raw, error: err?.message || "Unexpected error" },
      { status: 500 }
    );
  }
}
