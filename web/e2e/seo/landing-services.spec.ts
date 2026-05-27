/**
 * SEO Phase 2.0b — service landing pages spec.
 *
 * Covers the new public routes:
 *   /services                  — catalog index
 *   /services/[category]       — dynamic, gated by provider density
 *
 * Density behaviour in the local dev environment may put the
 * Electrician slug into any of three states (indexable, noindex,
 * notfound) depending on whether the test database has seed
 * providers. The tests are written to be robust to all three —
 * they assert the contract for whatever state the dev server
 * returns, not a fixed count.
 *
 * Privacy guarantees pinned:
 *   - No provider phone / name / provider_id / area string appears
 *     in the rendered HTML of any /services/[slug] page that
 *     returns 200.
 *   - The sitemap never emits an invalid slug under /services/.
 */

import { gotoPath } from "../_support/home";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

const EXPECTED_SLUGS = [
  "electrician",
  "plumber",
  "ac-repair",
  "carpenter",
  "painter",
] as const;

// ─────────────────────────────────────────────────────────────────────
//  /services catalog index
// ─────────────────────────────────────────────────────────────────────

test.describe("Phase 2.0b — /services catalog", () => {
  test("renders 200 with H1 'Services in Jodhpur'", async ({ request }) => {
    const res = await request.get(appUrl("/services"));
    expect(res.status()).toBe(200);
    const html = await res.text();
    expect(html).toMatch(
      /<h1[^>]+data-testid="services-index-h1"[^>]*>[^<]*Services in Jodhpur[^<]*<\/h1>/i
    );
  });

  test("links to all 5 pilot service pages", async ({ request }) => {
    const res = await request.get(appUrl("/services"));
    const html = await res.text();
    for (const slug of EXPECTED_SLUGS) {
      expect(
        html,
        `catalog should link to /services/${slug}`
      ).toContain(`/services/${slug}`);
      // Each link carries its own testid so a future refactor can't
      // silently drop one of the 5 without failing this test.
      expect(html).toContain(`data-testid="services-index-link-${slug}"`);
    }
  });

  test("emits canonical + BreadcrumbList JSON-LD", async ({ request }) => {
    const res = await request.get(appUrl("/services"));
    const html = await res.text();
    expect(html).toMatch(/<link[^>]+rel="canonical"[^>]+href="[^"]*\/services"/);
    expect(html).toContain("application/ld+json");
    expect(html).toMatch(/"@type"\s*:\s*"BreadcrumbList"/);
  });

  test("CTA back to homepage is present", async ({ request }) => {
    const res = await request.get(appUrl("/services"));
    const html = await res.text();
    expect(html).toContain('data-testid="services-index-home-cta"');
    expect(html).toContain("Post your task on Kaun Karega");
  });
});

// ─────────────────────────────────────────────────────────────────────
//  /services/[category] dynamic page
// ─────────────────────────────────────────────────────────────────────

test.describe("Phase 2.0b — /services/electrician", () => {
  // Helper — the page may return 200 (indexable OR noindex) OR 404
  // (notfound when count=0 in the local DB). Most assertions only
  // make sense when 200. Tests branch accordingly.

  test("returns 200 (with content) OR 404 (no providers)", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/services/electrician"));
    expect(
      [200, 404],
      `unexpected status ${res.status()} for /services/electrician`
    ).toContain(res.status());
  });

  test("if 200, H1 mentions Electrician + Jodhpur, has canonical + 3 JSON-LD nodes", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/services/electrician"));
    if (res.status() === 404) {
      test
        .info()
        .annotations.push({
          type: "skip-reason",
          description:
            "Local DB has 0 active+verified Electrician providers; page 404s. Content assertions skipped.",
        });
      return;
    }
    expect(res.status()).toBe(200);
    const html = await res.text();

    // H1
    expect(html).toMatch(
      /<h1[^>]+data-testid="service-landing-h1"[^>]*>[^<]*Electrician[^<]*<\/h1>/i
    );
    expect(html).toMatch(/Electrician[^<]*Jodhpur|Jodhpur[^<]*Electrician/i);

    // Canonical
    expect(html).toMatch(
      /<link[^>]+rel="canonical"[^>]+href="[^"]*\/services\/electrician"/
    );

    // Three JSON-LD nodes
    expect(html).toMatch(/"@type"\s*:\s*"Service"/);
    expect(html).toMatch(/"@type"\s*:\s*"BreadcrumbList"/);
    expect(html).toMatch(/"@type"\s*:\s*"FAQPage"/);
  });

  test("if 200, page HTML never exposes provider PII", async ({ request }) => {
    const res = await request.get(appUrl("/services/electrician"));
    if (res.status() === 404) return; // nothing to scan

    const html = await res.text();
    // Forbidden DB-shape field names — these are admin-endpoint
    // columns and must never appear in a public page's HTML.
    for (const forbidden of [
      "provider_id",
      "providerId",
      "phoneMasked",
      "full_name",
      "fullName",
    ]) {
      expect(
        html.toLowerCase().includes(forbidden.toLowerCase()),
        `landing page leaked forbidden field "${forbidden}"`
      ).toBe(false);
    }
    // Phone-leak heuristics — structural, not raw digit counts.
    // Next.js dev mode embeds arbitrary 10-digit build-hash IDs in
    // <script> srcs, so digit-only regexes are too noisy. Real
    // phone leaks surface as `tel:` hrefs (click-to-call links) or
    // the `+91` country-code prefix when displayed. Neither
    // appears in Next build artifacts, so both are reliable
    // signals of an actual leak.
    expect(
      /tel:\s*\+?\d/i.test(html),
      "landing page contains a `tel:` href"
    ).toBe(false);
    expect(
      /\+91[\s-]?\d/.test(html),
      "landing page contains a `+91` phone prefix"
    ).toBe(false);
  });

  test("if 200, page surfaces the CTA back to the homepage with category prefill", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/services/electrician"));
    if (res.status() === 404) return;
    const html = await res.text();
    expect(html).toContain('data-testid="service-landing-cta-post"');
    // Anchor must point at the homepage with the canonical name
    // URL-encoded so HomePageClient's existing ?category=… reader
    // pre-fills the search input.
    expect(html).toContain('href="/?category=Electrician"');
  });

  test("renders in a browser without console errors when 200", async ({
    page,
    diag,
  }) => {
    diag.allowConsoleError(/Failed to load resource.*401/);
    diag.allowHttpError(/whoami/);
    diag.allowConsoleError(/Failed to load resource.*404/);
    diag.allowHttpError(/provider\/notifications/);

    const response = await page.goto(appUrl("/services/electrician"));
    if (response?.status() === 404) {
      // Page 404s in dev because no providers; that's still a clean
      // outcome from the gate's perspective.
      return;
    }
    await expect(page).toHaveTitle(/Electrician.*Kaun Karega|Kaun Karega.*Electrician/i);
    diag.assertClean();
  });
});

// ─────────────────────────────────────────────────────────────────────
//  /services/[category] — invalid slug
// ─────────────────────────────────────────────────────────────────────

test.describe("Phase 2.0b — invalid slug behaviour", () => {
  test("/services/banjo-repair returns 404", async ({ request }) => {
    const res = await request.get(appUrl("/services/banjo-repair"));
    expect(res.status()).toBe(404);
  });

  test("/services/PLUMBER (case-insensitive variant) resolves OR 404s — never 5xx", async ({
    request,
  }) => {
    // Phase 2.0a normalizeSlug is permissive (lowercases input),
    // but Next routes are case-sensitive by default — Next 16
    // treats /services/Plumber as a distinct URL from
    // /services/plumber and may NOT route it through the same
    // generateStaticParams. Either it 404s (Next strict routing)
    // or it routes through and the gate decides. Both are fine;
    // assert no 5xx.
    const res = await request.get(appUrl("/services/PLUMBER"));
    expect(
      [200, 404],
      `unexpected status ${res.status()} for /services/PLUMBER`
    ).toContain(res.status());
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Sitemap integration
// ─────────────────────────────────────────────────────────────────────

test.describe("Phase 2.0b — sitemap integration", () => {
  test("sitemap.xml contains /services index", async ({ request }) => {
    const res = await request.get(appUrl("/sitemap.xml"));
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("https://kaunkarega.com/services");
  });

  test("sitemap.xml never lists an invalid /services/[slug]", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/sitemap.xml"));
    const body = await res.text();
    // The sitemap iterates the allow-list, so unknown slugs are
    // structurally excluded. This regression guard pins that
    // property — if a future code change adds raw DB-driven slugs
    // to the sitemap, this assertion fires.
    expect(body).not.toContain("/services/banjo-repair");
    expect(body).not.toContain("/services/unknown-svc");
    expect(body).not.toContain("/services/totally-fake-service");
  });

  test("sitemap.xml entries under /services/ are all in the allow-list", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/sitemap.xml"));
    const body = await res.text();
    // Extract every <loc> that points under /services/<slug>
    // (NOT the bare /services index) and assert each one resolves
    // to an allow-listed slug.
    const matches = Array.from(
      body.matchAll(/<loc>https:\/\/kaunkarega\.com\/services\/([^<]+)<\/loc>/g)
    );
    const slugs = matches.map((m) => m[1]);
    for (const slug of slugs) {
      expect(
        EXPECTED_SLUGS.includes(slug as (typeof EXPECTED_SLUGS)[number]),
        `sitemap emitted /services/${slug} which is not in the Phase 2.0 allow-list`
      ).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────
//  Smoke browser navigation (covers Suspense/hydration boundaries)
// ─────────────────────────────────────────────────────────────────────

test.describe("Phase 2.0b — browser navigation smoke", () => {
  test("user can navigate Home → Services → first category card", async ({
    page,
    diag,
  }) => {
    diag.allowConsoleError(/Failed to load resource.*401/);
    diag.allowHttpError(/whoami/);

    await gotoPath(page, "/services");
    await expect(page.getByTestId("services-index-h1")).toBeVisible();

    // Click the first available service link and verify nav.
    // next/link uses soft (client-side) navigation, which doesn't
    // fire a fresh DOM `load` event — `waitForURL` is the correct
    // synchroniser for the URL change.
    for (const slug of EXPECTED_SLUGS) {
      const link = page.getByTestId(`services-index-link-${slug}`);
      if (await link.isVisible().catch(() => false)) {
        await Promise.all([
          page.waitForURL(new RegExp(`/services/${slug}(?:$|[?#])`)),
          link.click(),
        ]);
        expect(page.url()).toContain(`/services/${slug}`);
        break;
      }
    }
    diag.assertClean();
  });
});
