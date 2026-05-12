import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { getArchivedCategoryKeys } from "@/lib/admin/adminCategoryMutations";
import { adminSupabase } from "@/lib/supabase/admin";

// GET /api/admin/categories
// Returns canonical categories with their currently-active aliases bundled.
//
// Sources:
//   - categories         : name, active                 (canonical list)
//   - category_aliases   : alias, canonical_category, alias_type, active=true
//
// Display-layer normalization (does NOT mutate the DB):
//   - categories rows are grouped by name.trim().toLowerCase(). The
//     `categories` table currently contains historical duplicates
//     (e.g. "AC Cleaning" and "ac cleaning"); without grouping they
//     would render as separate rows in the admin UI.
//   - For each group:
//       displayName = the first non-empty original `name` encountered
//       active      = OR of every row's active flag (if ANY duplicate is
//                     active, the merged row reads as active — per spec)
//       aliases     = aliasesByCanonical[groupKey], deduped by
//                     alias.trim().toLowerCase()
//   - Output is sorted case-insensitively by displayName.
//
// Caveat: edit_category / toggle_category act on the exact `name` row
// in the DB. With duplicates still present, mutations only affect the
// row matching displayName; siblings keep their old state. The OR-merge
// active gate may then make a Disable look "stuck" until the duplicates
// are cleaned up. Cleanup is intentionally out of scope here.

type AliasRow = { id: string; alias: string; aliasType: string | null };
type CategoryRow = {
  name: string;
  active: boolean;
  aliases: AliasRow[];
};

function isActiveValue(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value ?? "").toLowerCase().trim();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const [categoriesRes, aliasesRes, archivedKeys] = await Promise.all([
    adminSupabase
      .from("categories")
      .select("name, active")
      .order("name", { ascending: true }),
    adminSupabase
      .from("category_aliases")
      .select("id, alias, canonical_category, alias_type, active")
      .eq("active", true)
      .order("alias", { ascending: true }),
    // Archived categories (status='archived' in category_archive_reviews)
    // are filtered out of the Approved list further down. Disabled-only
    // categories (no archive row) still surface with strikethrough, so
    // the existing Disable/Enable toggle keeps its current behavior.
    getArchivedCategoryKeys(),
  ]);

  if (categoriesRes.error) {
    return NextResponse.json(
      { ok: false, error: `categories query failed: ${categoriesRes.error.message}` },
      { status: 500 }
    );
  }
  if (aliasesRes.error) {
    return NextResponse.json(
      { ok: false, error: `category_aliases query failed: ${aliasesRes.error.message}` },
      { status: 500 }
    );
  }

  // Group active aliases by canonical_category (already case-folded).
  const aliasesByCanonical = new Map<string, AliasRow[]>();
  for (const row of aliasesRes.data ?? []) {
    const canonical = String((row as { canonical_category?: unknown }).canonical_category ?? "")
      .trim()
      .toLowerCase();
    if (!canonical) continue;
    const existing = aliasesByCanonical.get(canonical) ?? [];
    existing.push({
      id: String((row as { id?: unknown }).id ?? ""),
      alias: String((row as { alias?: unknown }).alias ?? ""),
      aliasType:
        (row as { alias_type?: unknown }).alias_type != null
          ? String((row as { alias_type?: unknown }).alias_type)
          : null,
    });
    aliasesByCanonical.set(canonical, existing);
  }

  // Group categories rows by lowercased+trimmed name. Build merged
  // displayName + active per group.
  const grouped = new Map<
    string,
    { displayName: string; active: boolean }
  >();
  for (const row of categoriesRes.data ?? []) {
    const rawName = String((row as { name?: unknown }).name ?? "").trim();
    if (!rawName) continue;
    const key = rawName.toLowerCase();
    // Hide archived categories from the Approved list. The archive
    // table is the single source of truth for "this category should
    // disappear from active surfaces" — categories.active alone is
    // ambiguous (it's also the Disable/Enable toggle).
    if (archivedKeys.has(key)) continue;
    const rowActive = isActiveValue((row as { active?: unknown }).active);
    const existing = grouped.get(key);
    if (existing) {
      existing.active = existing.active || rowActive;
    } else {
      grouped.set(key, { displayName: rawName, active: rowActive });
    }
  }

  // Build output: dedupe aliases per group (by lowercased alias text),
  // attach to the merged category row.
  const categories: CategoryRow[] = [];
  for (const [key, { displayName, active }] of grouped) {
    const aliasList = aliasesByCanonical.get(key) ?? [];
    const aliasSeen = new Set<string>();
    const dedupedAliases: AliasRow[] = [];
    for (const a of aliasList) {
      const aliasKey = a.alias.trim().toLowerCase();
      if (!aliasKey || aliasSeen.has(aliasKey)) continue;
      aliasSeen.add(aliasKey);
      dedupedAliases.push(a);
    }
    categories.push({ name: displayName, active, aliases: dedupedAliases });
  }

  categories.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );

  return NextResponse.json({ ok: true, categories });
}
