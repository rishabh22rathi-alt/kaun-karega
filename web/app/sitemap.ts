import type { MetadataRoute } from "next";

import { getServiceLandingDecision } from "@/lib/seo/landingPageData";
import { listAllowedServices } from "@/lib/seo/slugs";

/**
 * /sitemap.xml — served by Next from app/sitemap.ts.
 *
 * Phase 1 baseline (homepage + legal pages) + Phase 2.0b additions:
 *   - /services — catalog index, always included.
 *   - /services/[slug] — only entries whose
 *     `getServiceLandingDecision(slug).status === "indexable"` make
 *     the cut. Below-threshold (noindex) and zero-provider
 *     (notfound) pages are intentionally omitted so Google never
 *     discovers thin or 404 URLs through the sitemap.
 *
 * Sitemap and the rendered pages call the SAME helper
 * (getServiceLandingDecision), so the two surfaces can never
 * disagree — a noindex page can never end up in the sitemap, and
 * every URL listed here is guaranteed to render an indexable page.
 *
 * Revalidation: 1 hour. Provider counts change slowly enough that
 * an hourly refresh window is plenty; a build-time-only snapshot
 * would make pages stay out of (or in) the sitemap for the entire
 * deploy cycle, which is too coarse for a marketplace whose
 * density grows daily.
 *
 * lastModified is build-time for the static URLs and the catalog
 * index. Phase 2.1+ can drive per-category `lastModified` from a
 * MAX(providers.updated_at) read; for Phase 2.0b a single build
 * timestamp is acceptable because the per-page content (copy +
 * FAQs) only changes via a code deploy anyway.
 */

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = "https://kaunkarega.com";
  const lastModified = new Date();

  const staticUrls: MetadataRoute.Sitemap = [
    {
      url: `${base}/`,
      lastModified,
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${base}/privacy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${base}/privacy-policy`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${base}/terms`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${base}/disclaimer`,
      lastModified,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  // Catalog index — always indexable, independent of any per-category
  // density. Even if every category fell below threshold today, the
  // catalog page itself is the user's discovery entry point.
  const servicesIndex: MetadataRoute.Sitemap[number] = {
    url: `${base}/services`,
    lastModified,
    changeFrequency: "weekly",
    priority: 0.9,
  };

  // Per-category pages — only those passing the indexability gate.
  // Failures (DB down) fall through getServiceLandingDecision as
  // "notfound" and are silently excluded — same fail-safe path the
  // page renderer uses.
  const decisions = await Promise.all(
    listAllowedServices().map(async (service) => ({
      slug: service.slug,
      decision: await getServiceLandingDecision(service.slug),
    }))
  );

  const categoryUrls: MetadataRoute.Sitemap = decisions
    .filter(({ decision }) => decision.status === "indexable")
    .map(({ slug }) => ({
      url: `${base}/services/${slug}`,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: 0.8,
    }));

  return [...staticUrls, servicesIndex, ...categoryUrls];
}
