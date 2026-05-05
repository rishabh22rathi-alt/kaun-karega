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
