import { adminSupabase } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Safety cap for both queries. Far above any realistic active-category /
// active-alias count; will not fire under normal data volumes. Prevents a
// pathological response if either table is ever flooded.
const MAX_ROWS = 200;

// Public endpoint — homepage search/category suggestions read this.
// Use service-role client to bypass RLS (mirrors /api/areas), and gate to
// active=true so freshly-approved categories show up without code changes.
// Order by `name` (always present) instead of `created_at`, which is not
// guaranteed to exist on this table.
export async function GET(request: Request) {
  // Opt-in flag: only when `?include=aliases` is present do we query
  // category_aliases and return the suggestions[] array. Default path is
  // byte-for-byte identical to today, so existing consumers (homepage,
  // provider registration page, e2e mocks) are unaffected.
  const includeAliases =
    (new URL(request.url).searchParams.get("include") || "")
      .toLowerCase() === "aliases";

  const categoriesQuery = adminSupabase
    .from("categories")
    .select("name, active")
    .eq("active", true)
    .order("name", { ascending: true })
    .limit(MAX_ROWS);

  if (!includeAliases) {
    // ----- DEFAULT PATH (response shape unchanged) -----
    const { data, error } = await categoriesQuery;

    if (error) {
      console.error("[api/categories] fetch failed", error.message || error);
      return NextResponse.json(
        {
          ok: false,
          data: [],
          error: {
            message: error.message,
            details: error.details,
            hint: error.hint,
            code: error.code,
          },
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      data: data ?? [],
      error: null,
    });
  }

  // ----- OPT-IN PATH: ?include=aliases -----
  // Two queries run in parallel via Promise.all so total wall-clock latency
  // is max(t1, t2) rather than t1 + t2.
  const aliasesQuery = adminSupabase
    .from("category_aliases")
    .select("alias, canonical_category, active")
    .eq("active", true)
    .limit(MAX_ROWS);

  const [categoriesResult, aliasesResult] = await Promise.all([
    categoriesQuery,
    aliasesQuery,
  ]);

  if (categoriesResult.error) {
    console.error(
      "[api/categories] fetch failed",
      categoriesResult.error.message || categoriesResult.error
    );
    return NextResponse.json(
      {
        ok: false,
        data: [],
        error: {
          message: categoriesResult.error.message,
          details: categoriesResult.error.details,
          hint: categoriesResult.error.hint,
          code: categoriesResult.error.code,
        },
      },
      { status: 500 }
    );
  }

  const categories = categoriesResult.data ?? [];

  // Soft-fail on alias error: return canonical-only suggestions rather than
  // 500ing the whole request. Aliases are augmentation, not core data.
  if (aliasesResult.error) {
    console.warn(
      "[api/categories] alias fetch failed; returning canonical-only suggestions",
      aliasesResult.error.message || aliasesResult.error
    );
  }
  const aliasRows =
    aliasesResult.error || !aliasesResult.data ? [] : aliasesResult.data;

  // Active-canonical Set so we can drop aliases that point at an
  // inactive/missing canonical category. Keeps suggestions consistent with
  // what /api/find-provider will actually match.
  const activeCanonicalSet = new Set<string>(
    categories
      .map((row) => String(row.name || "").trim().toLowerCase())
      .filter((value) => value.length > 0)
  );

  type Suggestion = {
    label: string;
    canonical: string;
    type: "canonical" | "alias";
    matchPriority: 1 | 2;
  };
  const suggestions: Suggestion[] = [];

  // Canonical entries — matchPriority = 1. `canonical` mirrors `label` so
  // the client always submits the canonical key regardless of row type.
  for (const row of categories) {
    const name = String(row.name || "").trim();
    if (!name) continue;
    suggestions.push({
      label: name,
      canonical: name,
      type: "canonical",
      matchPriority: 1,
    });
  }

  // Dedupe set: lowercased labels already claimed by a canonical row.
  // Aliases whose label collides with a canonical name are dropped so the
  // UI never shows the same label twice (canonical wins).
  const takenLabels = new Set<string>(
    suggestions.map((s) => s.label.toLowerCase())
  );

  // Alias entries — matchPriority = 2. Filter inactive-canonical pointers
  // and label collisions; `canonical` is the resolved key the client will
  // submit (so the UI doesn't need to round-trip through resolveCategoryAlias).
  for (const row of aliasRows) {
    const label = String(row.alias || "").trim();
    const canonical = String(row.canonical_category || "").trim();
    if (!label || !canonical) continue;
    if (!activeCanonicalSet.has(canonical.toLowerCase())) continue;
    if (takenLabels.has(label.toLowerCase())) continue;

    suggestions.push({
      label,
      canonical,
      type: "alias",
      matchPriority: 2,
    });
    takenLabels.add(label.toLowerCase());
  }

  // Alphabetical by label; on tie, lower matchPriority first
  // (canonical before alias).
  suggestions.sort((a, b) => {
    const labelCmp = a.label
      .toLowerCase()
      .localeCompare(b.label.toLowerCase());
    if (labelCmp !== 0) return labelCmp;
    return a.matchPriority - b.matchPriority;
  });

  return NextResponse.json({
    ok: true,
    data: categories,
    suggestions,
    error: null,
  });
}
