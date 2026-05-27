// Server-only loaders for the closed-set category candidates + alias lookups
// used by the work-intake resolve route. READ-ONLY — selects only.

import { adminSupabase } from "@/lib/supabase/admin";

// Same bound as /api/categories (MAX_CATEGORY_ROWS) — canonicals are in the
// low hundreds. We send ONLY these names to the AI, never aliases/provider data.
const MAX_CATEGORY_ROWS = 500;
const MAX_ALIAS_ROWS = 1000;

// Short in-process TTL so resolve bursts don't re-hit Postgres each call. A
// stale window of a couple minutes is harmless for a suggestion-only flow.
const CATEGORY_CACHE_TTL_MS = 90_000;

let categoryCache: { at: number; names: string[] } | null = null;

/** Trim + lowercase + collapse internal whitespace — the membership key used
 *  everywhere else in the system (mirrors /api/categories normalizeCategoryKey). */
export function normalizeCategoryKey(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = String(v ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/**
 * Active canonical category NAMES. When `override` is provided (test hook only),
 * it is used verbatim and the DB/cache are bypassed. Throws on DB error so the
 * route can fall back to manual.
 */
export async function loadActiveCategoryNames(
  override?: string[]
): Promise<string[]> {
  if (override) return dedupePreserveOrder(override);

  const now = Date.now();
  if (categoryCache && now - categoryCache.at < CATEGORY_CACHE_TTL_MS) {
    return categoryCache.names;
  }

  const { data, error } = await adminSupabase
    .from("categories")
    .select("name")
    .eq("active", true)
    .limit(MAX_CATEGORY_ROWS);

  if (error) {
    throw new Error(error.message || "categories load failed");
  }

  const names = dedupePreserveOrder(
    (data ?? []).map((row) => String((row as { name?: unknown }).name || ""))
  );
  categoryCache = { at: now, names };
  return names;
}

/**
 * Returns the as-stored canonical name when `guess` matches an active category
 * (case/space-insensitive), else null. The server — never the AI — decides
 * membership.
 */
export function findActiveCanonical(
  activeNames: string[],
  guess: string
): string | null {
  const key = normalizeCategoryKey(guess);
  if (!key) return null;
  for (const name of activeNames) {
    if (normalizeCategoryKey(name) === key) return name;
  }
  return null;
}

/**
 * Set of normalized active alias labels under a given canonical, used to mark
 * suggested work tags as existing vs. new. Fails soft (empty set) so a lookup
 * error never blocks the resolve response.
 */
export async function loadActiveAliasKeys(
  canonical: string
): Promise<Set<string>> {
  const trimmed = String(canonical ?? "").trim();
  if (!trimmed) return new Set();
  try {
    const { data, error } = await adminSupabase
      .from("category_aliases")
      .select("alias")
      .eq("active", true)
      .ilike("canonical_category", trimmed)
      .limit(MAX_ALIAS_ROWS);
    if (error) return new Set();
    return new Set(
      (data ?? []).map((row) =>
        normalizeCategoryKey((row as { alias?: unknown }).alias)
      )
    );
  } catch {
    return new Set();
  }
}
