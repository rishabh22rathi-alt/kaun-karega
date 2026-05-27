/**
 * SEO Phase 2.0a — JSON-LD schema builders for service landing pages.
 *
 * Pure functions, no side effects. Each builder returns a plain
 * JS object suitable for `JSON.stringify(...)` inside an inlined
 * `<script type="application/ld+json">` tag. (Same emission pattern
 * already used in app/layout.tsx for the root Organization +
 * WebSite nodes — Googlebot reads JSON-LD on first render, no need
 * for next/script's deferred Script component.)
 *
 * Organization reference: every Service node here uses an `@id`
 * pointer at the root Organization in app/layout.tsx so Google
 * links the service back to the company entity instead of treating
 * the page as a standalone vendor.
 *
 * What this file does NOT build:
 *   - Review / AggregateRating — no honest review system exists yet
 *   - LocalBusiness per provider — privacy/consent gap in Phase 2.0a
 *   - Offer / pricing — variable; misleading-info risk
 *   - ItemList of providers — Phase 2.0a ships counts only
 */

const SITE_URL = "https://kaunkarega.com";
const ORG_ID = `${SITE_URL}/#organization`;

export type ServiceSchemaInput = {
  canonicalName: string;
  description: string;
  /** Optional — defaults to the canonical service URL. */
  url?: string;
};

export type BreadcrumbItem = {
  name: string;
  /** Absolute or path-relative URL. Relative paths will be prefixed
   * with the production origin so Google sees absolute URLs. */
  url: string;
};

export type FaqItem = {
  q: string;
  a: string;
};

/**
 * Service node. `areaServed` is the City+State pair so Google
 * understands the geo scope without us needing to register every
 * single Jodhpur neighbourhood here (those graduate to per-region
 * pages in Phase 2.3+).
 */
export function buildServiceSchema(input: ServiceSchemaInput) {
  const url = input.url
    ? toAbsoluteUrl(input.url)
    : `${SITE_URL}/services/${slugifyForUrl(input.canonicalName)}`;
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    serviceType: input.canonicalName,
    name: `${input.canonicalName} in Jodhpur`,
    description: input.description,
    url,
    provider: { "@id": ORG_ID },
    areaServed: {
      "@type": "City",
      name: "Jodhpur",
      containedInPlace: {
        "@type": "State",
        name: "Rajasthan",
      },
    },
  } as const;
}

/**
 * BreadcrumbList. Items must be in order from root → leaf.
 * Single-item breadcrumbs are allowed but Google effectively ignores
 * them (so the caller usually passes at least Home → Services → X).
 */
export function buildBreadcrumbSchema(items: readonly BreadcrumbItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: toAbsoluteUrl(item.url),
    })),
  } as const;
}

/**
 * FAQPage. Caller passes the same Q&A pairs that render visibly on
 * the page — the spec for FAQPage explicitly requires the structured
 * data to mirror visible content, otherwise the rich result is
 * suppressed.
 */
export function buildFAQSchema(items: readonly FaqItem[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  } as const;
}

// ─── helpers ───────────────────────────────────────────────────────

function toAbsoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  const path = url.startsWith("/") ? url : `/${url}`;
  return `${SITE_URL}${path}`;
}

/**
 * Last-resort slugifier for the default url field when callers don't
 * pass one. The first-class slug source is lib/seo/slugs.ts —
 * importing it here would create a cycle (slugs.ts → schema.ts in a
 * future refactor), so we inline a small subset. Output is the same
 * shape as `normalizeSlug` in slugs.ts: lowercase, hyphens, ASCII.
 */
function slugifyForUrl(value: string): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}
