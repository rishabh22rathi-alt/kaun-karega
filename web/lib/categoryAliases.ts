import { createClient } from "@/lib/supabase/server";

/**
 * Resolves a user-typed category to its canonical form using the
 * `category_aliases` Supabase table.
 *
 * - Normalizes input (trim + lowercase).
 * - Looks up an active alias row (case-insensitive).
 * - Returns canonical_category when found; otherwise returns the normalized input.
 * - Fails open on DB error so callers never lose the original input.
 */
export async function resolveCategoryAlias(inputCategory: string): Promise<string> {
  const normalized = String(inputCategory ?? "").trim().toLowerCase();
  if (!normalized) return normalized;

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("category_aliases")
      .select("canonical_category")
      .ilike("alias", normalized)
      .eq("active", true)
      .maybeSingle();

    if (error) {
      console.warn(
        "[resolveCategoryAlias] lookup failed; falling back to normalized input",
        error.message || error
      );
      return normalized;
    }

    const canonical = String(data?.canonical_category || "").trim();
    return canonical || normalized;
  } catch (err) {
    console.warn(
      "[resolveCategoryAlias] threw; falling back to normalized input",
      err instanceof Error ? err.message : err
    );
    return normalized;
  }
}

/**
 * Detail-aware variant of resolveCategoryAlias used by callers that need
 * to know whether the user typed an alias (so they can persist or filter
 * by it later) vs. typed a canonical directly.
 *
 * Returns:
 *   { canonical, matchedAlias }
 *
 * - canonical: the canonical_category from category_aliases when the input
 *   is a known alias; otherwise the normalized input (unchanged from
 *   resolveCategoryAlias' behaviour).
 * - matchedAlias: the alias label from category_aliases when the input is
 *   a known alias; null when the input was a canonical or unknown term.
 *
 * Fails open on DB error: returns { canonical: normalized, matchedAlias: null }
 * so callers behave identically to today's broad-matching path on transient
 * lookup failures.
 *
 * resolveCategoryAlias above is intentionally NOT changed — its single-string
 * return is depended on by other call sites that don't need detail.
 */
export type ResolvedCategoryDetail = {
  canonical: string;
  matchedAlias: string | null;
};

export async function resolveCategoryAliasDetailed(
  inputCategory: string
): Promise<ResolvedCategoryDetail> {
  const normalized = String(inputCategory ?? "").trim().toLowerCase();
  if (!normalized) return { canonical: normalized, matchedAlias: null };

  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("category_aliases")
      .select("alias, canonical_category")
      .ilike("alias", normalized)
      .eq("active", true)
      .maybeSingle();

    if (error) {
      console.warn(
        "[resolveCategoryAliasDetailed] lookup failed; falling back to normalized input",
        error.message || error
      );
      return { canonical: normalized, matchedAlias: null };
    }

    if (data) {
      const canonical = String(data.canonical_category || "").trim();
      const matchedAlias = String(data.alias || "").trim();
      return {
        canonical: canonical || normalized,
        matchedAlias: matchedAlias || null,
      };
    }

    return { canonical: normalized, matchedAlias: null };
  } catch (err) {
    console.warn(
      "[resolveCategoryAliasDetailed] threw; falling back to normalized input",
      err instanceof Error ? err.message : err
    );
    return { canonical: normalized, matchedAlias: null };
  }
}
