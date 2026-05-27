/**
 * SEO Phase 2.0a — service landing-page foundation spec.
 *
 * Covers the four scaffolding modules and the public stats endpoint.
 * No public /services or /services/[category] pages exist yet; this
 * spec proves the helpers + endpoint are ready for Phase 2.0b's
 * routing layer to consume.
 *
 * The pure-function helper tests (slugs, content, schema) import
 * the modules directly — Playwright tests run in Node, and these
 * modules have zero browser dependencies, so direct imports are
 * cleaner than spinning up a page and reading window state.
 *
 * The public endpoint tests use Playwright's `request` fixture
 * against the live dev server. They assert response shape +
 * absence of PII rather than exact counts, because real provider
 * counts move as the platform grows.
 */

import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

import {
  getServiceBySlug,
  getServiceSlug,
  listAllowedServices,
  normalizeSlug,
} from "@/lib/seo/slugs";
import {
  getServiceContent,
  listServiceContent,
} from "@/lib/seo/serviceContent";
import {
  buildBreadcrumbSchema,
  buildFAQSchema,
  buildServiceSchema,
} from "@/lib/seo/schema";

// The exact 5 slugs Phase 2.0a is allowed to ship for. Hard-coded
// here too so a future expansion of the allow-list cannot silently
// pass this spec — the count + membership are both pinned.
const EXPECTED_SLUGS = [
  "electrician",
  "plumber",
  "ac-repair",
  "carpenter",
  "painter",
] as const;

// ─────────────────────────────────────────────────────────────────────
//  lib/seo/slugs.ts — allow-list + helpers
// ─────────────────────────────────────────────────────────────────────

test.describe("Phase 2.0a — slugs helpers", () => {
  test("listAllowedServices() exposes exactly the 5 pilot services", () => {
    const services = listAllowedServices();
    expect(services).toHaveLength(EXPECTED_SLUGS.length);
    const actualSlugs = services.map((s) => s.slug).sort();
    expect(actualSlugs).toEqual([...EXPECTED_SLUGS].sort());
  });

  test("getServiceBySlug resolves valid slugs and rejects invalid ones", () => {
    for (const slug of EXPECTED_SLUGS) {
      const hit = getServiceBySlug(slug);
      expect(hit, `expected slug "${slug}" to resolve`).not.toBeNull();
      expect(hit?.slug).toBe(slug);
      expect(typeof hit?.canonical).toBe("string");
      expect(hit?.canonical.length).toBeGreaterThan(0);
    }
    // These inputs are not in the allow-list even after slug
    // normalisation, so they MUST reject:
    //   - "banjo-repair"  → not in list
    //   - ""              → empty
    //   - "../etc/passwd" → normalises to "etcpasswd", not in list
    //   - "unknown-svc"   → unknown
    for (const bad of ["banjo-repair", "", "../etc/passwd", "unknown-svc"]) {
      expect(getServiceBySlug(bad), `expected "${bad}" to reject`).toBeNull();
    }
    // Permissive normalisation contract — these "messy" inputs MUST
    // resolve because they normalise to a slug that IS in the
    // allow-list. This is by design (lib/seo/slugs.ts header
    // documents it): URL canonicalisation should be lenient on
    // input shape while the allow-list stays strict on membership.
    for (const messy of ["PLUMBER!", "  electrician  ", "AC-Repair"]) {
      const hit = getServiceBySlug(messy);
      expect(hit, `expected messy input "${messy}" to resolve`).not.toBeNull();
    }
  });

  test("getServiceSlug is the inverse of getServiceBySlug", () => {
    for (const service of listAllowedServices()) {
      expect(getServiceSlug(service.canonical)).toBe(service.slug);
    }
    expect(getServiceSlug("Banjo Repair")).toBeNull();
  });

  test("normalizeSlug coerces messy input deterministically", () => {
    expect(normalizeSlug("AC Repair")).toBe("ac-repair");
    expect(normalizeSlug("  Electrician  ")).toBe("electrician");
    expect(normalizeSlug("Plumber!!")).toBe("plumber");
    expect(normalizeSlug("a   b   c")).toBe("a-b-c");
    expect(normalizeSlug("--leading--trailing--")).toBe("leading-trailing");
    expect(normalizeSlug("")).toBe("");
  });
});

// ─────────────────────────────────────────────────────────────────────
//  lib/seo/serviceContent.ts — hand-authored copy contract
// ─────────────────────────────────────────────────────────────────────

test.describe("Phase 2.0a — service content contract", () => {
  test("content exists for every allow-listed slug", () => {
    for (const slug of EXPECTED_SLUGS) {
      const content = getServiceContent(slug);
      expect(content, `missing content for slug "${slug}"`).not.toBeNull();
      expect(content?.slug).toBe(slug);
    }
  });

  test("listServiceContent returns the 5 entries in allow-list order", () => {
    const entries = listServiceContent();
    expect(entries).toHaveLength(EXPECTED_SLUGS.length);
    for (const entry of entries) {
      expect(typeof entry.h1).toBe("string");
      expect(entry.h1.length).toBeGreaterThan(0);
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(50);
      expect(entry.h1.toLowerCase()).toContain("jodhpur");
    }
  });

  test("every service has at least 3 FAQ entries", () => {
    for (const entry of listServiceContent()) {
      expect(
        entry.faq.length,
        `slug "${entry.slug}" has only ${entry.faq.length} FAQ entries`
      ).toBeGreaterThanOrEqual(3);
      for (const item of entry.faq) {
        expect(item.q.length).toBeGreaterThan(0);
        expect(item.a.length).toBeGreaterThan(0);
      }
    }
  });

  test("every relatedServiceSlug points to another allow-listed slug", () => {
    const allowed = new Set(EXPECTED_SLUGS as readonly string[]);
    for (const entry of listServiceContent()) {
      for (const related of entry.relatedServiceSlugs) {
        expect(
          allowed.has(related),
          `slug "${entry.slug}" references unknown related slug "${related}"`
        ).toBe(true);
        expect(
          related,
          `slug "${entry.slug}" lists itself in relatedServiceSlugs`
        ).not.toBe(entry.slug);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
//  lib/seo/schema.ts — JSON-LD builders
// ─────────────────────────────────────────────────────────────────────

test.describe("Phase 2.0a — schema builders", () => {
  test("buildServiceSchema produces a Service node for Electrician", () => {
    const node = buildServiceSchema({
      canonicalName: "Electrician",
      description: "Electrician services in Jodhpur.",
    });
    expect(node["@context"]).toBe("https://schema.org");
    expect(node["@type"]).toBe("Service");
    expect(node.serviceType).toBe("Electrician");
    expect(node.name).toContain("Electrician");
    expect(node.name).toContain("Jodhpur");
    expect(node.url).toBe("https://kaunkarega.com/services/electrician");
    expect(node.provider).toEqual({
      "@id": "https://kaunkarega.com/#organization",
    });
    expect(node.areaServed.name).toBe("Jodhpur");
    expect(node.areaServed.containedInPlace.name).toBe("Rajasthan");
  });

  test("buildBreadcrumbSchema produces a positioned BreadcrumbList", () => {
    const node = buildBreadcrumbSchema([
      { name: "Home", url: "/" },
      { name: "Services", url: "/services" },
      { name: "Electrician", url: "/services/electrician" },
    ]);
    expect(node["@type"]).toBe("BreadcrumbList");
    expect(node.itemListElement).toHaveLength(3);
    expect(node.itemListElement[0]).toMatchObject({
      "@type": "ListItem",
      position: 1,
      name: "Home",
      item: "https://kaunkarega.com/",
    });
    expect(node.itemListElement[2]).toMatchObject({
      position: 3,
      name: "Electrician",
      item: "https://kaunkarega.com/services/electrician",
    });
  });

  test("buildFAQSchema produces a FAQPage with Question/Answer pairs", () => {
    const node = buildFAQSchema([
      { q: "Q1?", a: "A1." },
      { q: "Q2?", a: "A2." },
    ]);
    expect(node["@type"]).toBe("FAQPage");
    expect(node.mainEntity).toHaveLength(2);
    expect(node.mainEntity[0]).toEqual({
      "@type": "Question",
      name: "Q1?",
      acceptedAnswer: { "@type": "Answer", text: "A1." },
    });
  });
});

// ─────────────────────────────────────────────────────────────────────
//  /api/public/category-stats — public endpoint
// ─────────────────────────────────────────────────────────────────────

test.describe("Phase 2.0a — public category-stats endpoint", () => {
  test("invalid slug returns 404 with {ok:false}", async ({ request }) => {
    const res = await request.get(
      appUrl("/api/public/category-stats?slug=banjo-repair")
    );
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { ok?: boolean; error?: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe("INVALID_SLUG");
  });

  test("missing slug returns 404 too", async ({ request }) => {
    const res = await request.get(appUrl("/api/public/category-stats"));
    expect(res.status()).toBe(404);
    const body = (await res.json()) as { ok?: boolean };
    expect(body.ok).toBe(false);
  });

  test("valid slug returns ONLY the four allowed keys", async ({
    request,
  }) => {
    const res = await request.get(
      appUrl("/api/public/category-stats?slug=electrician")
    );
    // Endpoint may legitimately return 500 if Supabase is unreachable
    // in the dev environment. Either 200 or 500 is acceptable — we
    // care about the response shape, not the value, in either case.
    expect([200, 500]).toContain(res.status());
    const body = (await res.json()) as Record<string, unknown>;

    if (res.status() === 200) {
      expect(body.ok).toBe(true);
      expect(body.category).toBe("Electrician");
      expect(body.slug).toBe("electrician");
      expect(typeof body.count).toBe("number");
      expect(Object.keys(body).sort()).toEqual(
        ["category", "count", "ok", "slug"].sort()
      );
    } else {
      expect(body.ok).toBe(false);
      expect(body.error).toBe("STATS_FAILED");
      // 500 envelope is exactly {ok, error} — no leak path.
      expect(Object.keys(body).sort()).toEqual(["error", "ok"].sort());
    }
  });

  test("response body never contains PII fields or phone-shaped numbers", async ({
    request,
  }) => {
    // Run the privacy scan for all 5 allow-listed slugs so any
    // future change that leaks data for a specific category is
    // caught regardless of which one we tested above.
    for (const slug of EXPECTED_SLUGS) {
      const res = await request.get(
        appUrl(`/api/public/category-stats?slug=${slug}`)
      );
      const raw = await res.text();
      // Forbidden field names — these are admin-endpoint columns
      // that must never appear in the public payload.
      for (const forbidden of [
        "phone",
        "provider_id",
        "providerId",
        "full_name",
        "fullName",
        "area",
        "address",
      ]) {
        expect(
          raw.toLowerCase().includes(forbidden.toLowerCase()),
          `slug "${slug}" response leaked forbidden field "${forbidden}"`
        ).toBe(false);
      }
      // Phone-shaped sequence — Indian mobile numbers MUST start
      // with 6, 7, 8, or 9 (TRAI prefix range). The tighter pattern
      // catches a real leaked provider phone while ignoring
      // arbitrary 10-digit runs in build artifacts. The endpoint
      // response is JSON so build hashes shouldn't appear anyway,
      // but this matches the same regex used on the HTML pages.
      expect(
        /(?:\+?91[ -]?)?[6-9]\d{9}/.test(raw),
        `slug "${slug}" response contains an Indian-mobile-shaped sequence`
      ).toBe(false);
    }
  });
});
