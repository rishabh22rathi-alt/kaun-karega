// Server-only loaders for the closed-set category candidates + alias lookups
// used by the work-intake resolve route. READ-ONLY — selects only.

import { adminSupabase } from "@/lib/supabase/admin";
import { WORK_INTAKE_MAX_ALIASES_PER_CATEGORY } from "@/lib/workIntake/types";

// Same bound as /api/categories (MAX_CATEGORY_ROWS) — canonicals are in the
// low hundreds. The names themselves are the closed set; the alias list below
// is sent alongside as disambiguation hints, never as the source of membership.
const MAX_CATEGORY_ROWS = 500;
const MAX_ALIAS_ROWS = 1000;
// Bound the full alias table fetch for prompt enrichment. ~290 rows live today
// in production; 4000 leaves ~10x headroom before we'd need pagination.
const MAX_ALIAS_GROUP_ROWS = 4000;

// Short in-process TTL so resolve bursts don't re-hit Postgres each call. A
// stale window of a couple minutes is harmless for a suggestion-only flow.
const CATEGORY_CACHE_TTL_MS = 90_000;

let categoryCache: { at: number; names: string[] } | null = null;
// Cache the full alias table grouped by active canonical. The signature key is
// the sorted-active-names list so cache entries invalidate when the active set
// changes (e.g. an admin toggles a category active/inactive).
let aliasGroupCache: {
  at: number;
  sig: string;
  byCanonical: Map<string, string[]>;
} | null = null;

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
 * Map of active canonical → ordered, deduped, capped list of active alias
 * labels under it. Used to seed the AI candidate block with disambiguation
 * hints (e.g. "fan repair" / "cooler wiring" belong under Electrician), so
 * the model doesn't have to guess between similar-sounding canonicals.
 *
 * Grouping is case/space-insensitive, so legacy rows tagged with a different
 * casing of the canonical (e.g. "ac repair" vs the active "AC Repair") merge
 * into the active entry. Aliases whose canonical_category is not in the active
 * set are dropped (never shown to the model). Fails soft (empty Map) so an
 * alias-table outage never blocks resolution — the AI then sees names only,
 * which is the prior behaviour.
 *
 * Either pass `override` (test hook: pre-built canonical→aliases map, bypasses
 * the DB) or rely on the in-process cache keyed by the active-names signature.
 */
export async function loadActiveAliasesByCanonical(
  activeNames: string[],
  override?: Record<string, string[]> | Map<string, string[]>
): Promise<Map<string, string[]>> {
  // Build the canonical-key → as-stored-name map once. Lookups against
  // aliases.canonical_category use this so casing differences merge cleanly.
  const keyToCanonical = new Map<string, string>();
  for (const name of activeNames) {
    const key = normalizeCategoryKey(name);
    if (key && !keyToCanonical.has(key)) keyToCanonical.set(key, name);
  }
  if (keyToCanonical.size === 0) return new Map();

  // Test-hook override: build directly from caller-supplied groups without
  // touching the DB. Same active-set filtering + per-category cap as the DB
  // path so test behaviour matches prod.
  if (override) {
    const entries =
      override instanceof Map
        ? Array.from(override.entries())
        : Object.entries(override);
    const out = new Map<string, string[]>();
    for (const [canonRaw, list] of entries) {
      const canonKey = normalizeCategoryKey(canonRaw);
      const active = keyToCanonical.get(canonKey);
      if (!active) continue;
      out.set(
        active,
        capAndDedupeAliases(Array.isArray(list) ? list : [], active)
      );
    }
    return out;
  }

  const sig = activeNames
    .map((n) => normalizeCategoryKey(n))
    .sort()
    .join("|");
  const now = Date.now();
  if (
    aliasGroupCache &&
    aliasGroupCache.sig === sig &&
    now - aliasGroupCache.at < CATEGORY_CACHE_TTL_MS
  ) {
    return aliasGroupCache.byCanonical;
  }

  let rows: Array<{ alias?: unknown; canonical_category?: unknown }> = [];
  try {
    const { data, error } = await adminSupabase
      .from("category_aliases")
      .select("alias, canonical_category")
      .eq("active", true)
      .limit(MAX_ALIAS_GROUP_ROWS);
    if (error) return new Map();
    rows = (data ?? []) as typeof rows;
  } catch {
    return new Map();
  }

  const buckets = new Map<string, string[]>();
  for (const row of rows) {
    const alias = String(row.alias ?? "").trim();
    if (!alias) continue;
    const canonKey = normalizeCategoryKey(row.canonical_category);
    const active = keyToCanonical.get(canonKey);
    if (!active) continue;
    const list = buckets.get(active);
    if (list) list.push(alias);
    else buckets.set(active, [alias]);
  }

  const out = new Map<string, string[]>();
  for (const [active, list] of buckets) {
    out.set(active, capAndDedupeAliases(list, active));
  }
  aliasGroupCache = { at: now, sig, byCanonical: out };
  return out;
}

/**
 * Trim + dedupe (case-insensitive) + drop any alias that is itself the
 * canonical name, then cap to WORK_INTAKE_MAX_ALIASES_PER_CATEGORY. Order is
 * preserved as fetched so admin curation choices win over insertion races.
 */
function capAndDedupeAliases(values: string[], canonical: string): string[] {
  const canonKey = normalizeCategoryKey(canonical);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const trimmed = String(v ?? "").trim();
    if (!trimmed) continue;
    const key = normalizeCategoryKey(trimmed);
    if (!key || key === canonKey || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
    if (out.length >= WORK_INTAKE_MAX_ALIASES_PER_CATEGORY) break;
  }
  return out;
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
