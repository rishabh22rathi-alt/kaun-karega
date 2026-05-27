/**
 * SEO Phase 2.0a — service-slug allow-list and helpers.
 *
 * This file is the *single* place that decides which categories
 * become public /services/[category] pages. The allow-list is
 * deliberately small (5 entries) so each landing page can carry
 * hand-authored content (see lib/seo/serviceContent.ts). Adding a
 * new entry here is a conscious decision that must come with
 * matching content + a FAQ block — never auto-generate from the DB.
 *
 * Why hardcoded:
 *   - The `categories` table has no `slug` column today, so the
 *     mapping has to live somewhere. A code map is reversible,
 *     diff-able, and PR-reviewable. A future Phase 2.1+ migration
 *     can introduce a `slug` column when scale demands it.
 *   - Auto-generating slugs from every active category in the DB
 *     would create thin-content / doorway-page risk — exactly
 *     what Google's quality guidelines penalise.
 *
 * Slug rules: lowercase ASCII, hyphens for spaces, no diacritics,
 * no characters outside [a-z0-9-]. `normalizeSlug` enforces this so
 * input from any source (URL, query string, external link) resolves
 * deterministically.
 */

export type AllowedService = {
  /** Canonical category name as stored in `categories.name`. */
  canonical: string;
  /** URL slug used in /services/[slug]. ASCII-only, lowercase. */
  slug: string;
};

// ⚠️  STRICT ALLOW-LIST.  Each entry needs matching content in
// lib/seo/serviceContent.ts before its /services/[slug] page is
// allowed to ship. Do not extend this list without that pairing.
const ALLOWED_SERVICES: readonly AllowedService[] = [
  { canonical: "Electrician", slug: "electrician" },
  { canonical: "Plumber", slug: "plumber" },
  { canonical: "AC Repair", slug: "ac-repair" },
  { canonical: "Carpenter", slug: "carpenter" },
  { canonical: "Painter", slug: "painter" },
] as const;

/**
 * Returns the slug for a canonical category name, or null if the
 * canonical is not in the allow-list. Case-insensitive on the
 * canonical comparison so DB rows with mixed casing still match.
 */
export function getServiceSlug(canonicalName: string): string | null {
  const needle = String(canonicalName).trim().toLowerCase();
  if (!needle) return null;
  const match = ALLOWED_SERVICES.find(
    (entry) => entry.canonical.toLowerCase() === needle
  );
  return match?.slug ?? null;
}

/**
 * Returns the AllowedService for a URL slug, or null if the slug is
 * not in the allow-list. The input is normalised first so a
 * permissive caller (e.g. uppercase, trailing slash) still resolves.
 */
export function getServiceBySlug(slug: string): AllowedService | null {
  const candidate = normalizeSlug(slug);
  if (!candidate) return null;
  return ALLOWED_SERVICES.find((entry) => entry.slug === candidate) ?? null;
}

/**
 * Returns the full allow-list. Frozen at module load — callers must
 * not mutate. Used by the sitemap iterator + the (future) /services
 * catalog index + tests.
 */
export function listAllowedServices(): readonly AllowedService[] {
  return ALLOWED_SERVICES;
}

/**
 * Normalise arbitrary input into our slug shape: lowercase, trim,
 * spaces → hyphens, collapse repeats, drop everything outside
 * [a-z0-9-]. Returns empty string for unusable input — never throws.
 */
export function normalizeSlug(input: string): string {
  return String(input ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}
