import { adminSupabase } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Hard ceilings that protect against pathological responses. Previously a
// single MAX_ROWS=200 cap was applied to both queries, which silently
// truncated newer alias rows once category_aliases grew past 200 active
// entries (older rows like "lohar" stayed, newer rows like "seo"/"mali"
// disappeared). Split per table now so each can scale on its own curve:
// canonicals are bounded (~hundreds), aliases are the long tail and grow
// monotonically. The alias query also adds ORDER BY created_at DESC so the
// cap, when ever hit, is at least deterministic.
const MAX_CATEGORY_ROWS = 500;
const MAX_ALIAS_ROWS = 1000;

// Set-membership key for the "alias.canonical_category exists in
// categories.name" join. Both sides go through this so "Digital  Marketing"
// (double space, trailing whitespace, mixed case) matches "Digital Marketing".
// Trim + lowercase + collapse internal whitespace runs to a single space.
const normalizeCategoryKey = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

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
    .limit(MAX_CATEGORY_ROWS);

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
  // Includes `alias_type` so consumers (e.g. provider register work-tag UI)
  // can filter rows by tag kind. Pre-existing rows without alias_type fall
  // through with the field undefined; clients use that as a "no filter" cue.
  // ORDER BY created_at DESC pairs with the partial index
  // idx_category_aliases_active (active, created_at DESC) added in
  // 20260507120000_alias_review_and_notifications.sql, and — more
  // importantly — makes the LIMIT deterministic. Without an explicit
  // ORDER BY, PostgreSQL is free to drop newly inserted rows when
  // active alias count exceeds the cap; that is exactly how recent
  // aliases ("seo", "mali") went missing while older ones ("lohar")
  // stayed visible.
  // No alias_type filter — work_tag, local_name, search (and any future
  // type) all flow through; the homepage uses every kind for suggestions.
  const aliasesQuery = adminSupabase
    .from("category_aliases")
    .select("alias, canonical_category, active, alias_type")
    .eq("active", true)
    .order("created_at", { ascending: false })
    .limit(MAX_ALIAS_ROWS);

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
  if (categories.length === MAX_CATEGORY_ROWS) {
    console.warn(
      "[api/categories] categories cap hit (%d) — results may be truncated; raise MAX_CATEGORY_ROWS",
      MAX_CATEGORY_ROWS
    );
  }

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
  if (aliasRows.length === MAX_ALIAS_ROWS) {
    console.warn(
      "[api/categories] aliases cap hit (%d) — results may be truncated; raise MAX_ALIAS_ROWS",
      MAX_ALIAS_ROWS
    );
  }

  // Active-canonical Set so we can drop aliases that point at an
  // inactive/missing canonical category. Keeps suggestions consistent with
  // what /api/find-provider will actually match.
  // Built via normalizeCategoryKey so a canonical_category value with
  // accidental double spaces or trailing whitespace still matches the
  // categories.name row it actually points at.
  const activeCanonicalSet = new Set<string>(
    categories
      .map((row) => normalizeCategoryKey(row.name))
      .filter((value) => value.length > 0)
  );

  type Suggestion = {
    label: string;
    canonical: string;
    type: "canonical" | "alias";
    matchPriority: 1 | 2;
    // Only set on alias rows when the DB column has a non-empty value.
    // Consumers fall back to "no filter" when absent.
    aliasType?: string;
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
    // Membership check uses the same normalization the Set was built with
    // so whitespace-noise in canonical_category does not silently drop the
    // alias. The emitted `canonical` field below preserves the as-stored
    // value (response shape unchanged).
    if (!activeCanonicalSet.has(normalizeCategoryKey(canonical))) continue;
    if (takenLabels.has(label.toLowerCase())) continue;

    // Pass-through alias_type so the provider register page can filter
    // chips to ('work_tag','local_name'). Omitted from the row when blank
    // so default-shape consumers see no extra noise.
    const aliasType = String(
      (row as { alias_type?: unknown }).alias_type || ""
    ).trim();

    suggestions.push({
      label,
      canonical,
      type: "alias",
      matchPriority: 2,
      ...(aliasType ? { aliasType } : {}),
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
