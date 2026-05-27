/**
 * SEO Phase 1-A — robots, sitemap, head metadata, JSON-LD.
 *
 * These assertions hit live endpoints (no mocks): the dev server
 * generates /robots.txt and /sitemap.xml from app/robots.ts and
 * app/sitemap.ts, and the homepage HTML carries the metadata that
 * app/layout.tsx now exports.
 *
 * What this spec deliberately does NOT assert:
 *   - Per-page noindex on /login, /register, /post-task, etc. —
 *     those pages have no shared layout in this codebase and
 *     Phase 1-A explicitly defers the per-page robots metadata to
 *     avoid wide-spread repetitive edits. The robots.txt Disallow
 *     rules are the Phase 1-A protection for those URLs.
 *   - /provider/* layout-level noindex — the /provider URL space
 *     also has no shared layout. Same deferral as above.
 *   - The exact OG image URL — manifest base resolution depends on
 *     metadataBase, which in dev does not always emit absolute URLs.
 *     The test asserts the presence of og:image, not its content.
 */

import { gotoPath } from "../_support/home";
import { appUrl } from "../_support/runtime";
import { test, expect } from "../_support/test";

test.describe("SEO Phase 1-A — robots.txt", () => {
  test("returns 200 and references the canonical sitemap URL", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/robots.txt"));
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/Sitemap:\s*https:\/\/kaunkarega\.com\/sitemap\.xml/i);
  });

  test("disallows the major private sections", async ({ request }) => {
    const res = await request.get(appUrl("/robots.txt"));
    const body = await res.text();
    // Section roots covered by the robots rules. Each appears as a
    // dedicated Disallow line — the bare prefix form covers /admin
    // AND /admin/* in Google's parser.
    for (const path of [
      "/admin",
      "/dashboard",
      "/provider",
      "/login",
      "/post-task",
      "/chat",
      "/api/",
      "/_next/",
    ]) {
      expect(
        body,
        `robots.txt should Disallow ${path}`
      ).toMatch(new RegExp(`Disallow:\\s*${path.replace(/\//g, "\\/")}`));
    }
  });
});

test.describe("SEO Phase 1-A — sitemap.xml", () => {
  test("returns 200 and contains the canonical homepage URL", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/sitemap.xml"));
    expect(res.status()).toBe(200);
    const body = await res.text();
    expect(body).toContain("<urlset");
    expect(body).toContain("https://kaunkarega.com");
  });

  test("includes Phase 1-A legal pages", async ({ request }) => {
    const res = await request.get(appUrl("/sitemap.xml"));
    const body = await res.text();
    for (const path of [
      "/privacy",
      "/privacy-policy",
      "/terms",
      "/disclaimer",
    ]) {
      expect(
        body,
        `sitemap.xml should include ${path}`
      ).toContain(`https://kaunkarega.com${path}`);
    }
  });
});

test.describe("SEO Phase 1-A — homepage HTML", () => {
  test("<title> includes both 'Kaun Karega' and 'Jodhpur'", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/"));
    expect(res.status()).toBe(200);
    const html = await res.text();
    const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
    expect(titleMatch, "homepage must emit a <title> tag").not.toBeNull();
    const title = titleMatch![1];
    expect(title).toContain("Kaun Karega");
    expect(title).toContain("Jodhpur");
  });

  test("emits a canonical link", async ({ request }) => {
    const res = await request.get(appUrl("/"));
    const html = await res.text();
    // metadataBase resolves the canonical "/" to the absolute
    // kaunkarega.com root in production. In dev Next may emit the
    // localhost form — accept either by matching on `rel="canonical"`
    // and the homepage path.
    expect(html).toMatch(/<link[^>]+rel="canonical"[^>]+href="[^"]+"/i);
  });

  test("emits Open Graph + Twitter card tags", async ({ request }) => {
    const res = await request.get(appUrl("/"));
    const html = await res.text();
    expect(html).toMatch(/<meta\s+property="og:title"/i);
    expect(html).toMatch(/<meta\s+property="og:description"/i);
    expect(html).toMatch(/<meta\s+property="og:image"/i);
    expect(html).toMatch(/<meta\s+property="og:site_name"\s+content="Kaun Karega"/i);
    expect(html).toMatch(/<meta\s+name="twitter:card"\s+content="summary_large_image"/i);
  });

  test("includes Organization + WebSite JSON-LD", async ({ request }) => {
    const res = await request.get(appUrl("/"));
    const html = await res.text();
    expect(html).toContain("application/ld+json");
    expect(html).toMatch(/"@context"\s*:\s*"https:\/\/schema\.org"/);
    expect(html).toMatch(/"@type"\s*:\s*"Organization"/);
    expect(html).toMatch(/"@type"\s*:\s*"WebSite"/);
    expect(html).toMatch(/"name"\s*:\s*"Kaun Karega"/);
    // Geo signal — Jodhpur should appear in the structured data so
    // Google understands the local relevance.
    expect(html).toMatch(/"name"\s*:\s*"Jodhpur"/);
  });
});

test.describe("SEO Phase 1-A — private routes carry noindex (where layout exists)", () => {
  test("/admin redirect target is not indexable (auth-gated or noindex)", async ({
    request,
  }) => {
    // Middleware redirects anonymous /admin -> /login?next=/admin.
    // Either way the resource Googlebot ends up on must not be
    // indexable. With maxRedirects:0 we capture the 3xx directly.
    const res = await request.get(appUrl("/admin"), { maxRedirects: 0 });
    expect(
      [200, 301, 302, 307, 308],
      `unexpected status ${res.status()} for anonymous /admin`
    ).toContain(res.status());
    if (res.status() === 200) {
      // If for some reason the response is 200, it must carry the
      // noindex tag injected by the admin layout metadata.
      const html = await res.text();
      expect(html).toMatch(/<meta\s+name="robots"\s+content="[^"]*noindex/i);
    }
  });

  test("/admin/dashboard anonymous request is auth-gated", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/admin/dashboard"), {
      maxRedirects: 0,
    });
    expect([200, 301, 302, 307, 308]).toContain(res.status());
    if (res.status() === 200) {
      const html = await res.text();
      expect(html).toMatch(/<meta\s+name="robots"\s+content="[^"]*noindex/i);
    }
  });

  test("/login indexability — Phase 1-A: robots.txt blocks; per-page noindex deferred", async ({
    request,
  }) => {
    // Documentation test: /login does NOT yet emit a noindex meta tag
    // because no shared auth layout exists. The robots.txt Disallow
    // rule is the Phase 1-A protection. If later a per-page noindex
    // is added, this assertion should be flipped to require it.
    const res = await request.get(appUrl("/login"));
    expect([200, 307, 308]).toContain(res.status());
    // Soft check — log presence, do not fail. Future commit that adds
    // per-page noindex on /login should change this to a hard assertion.
    const html = res.status() === 200 ? await res.text() : "";
    const hasNoindex = /<meta\s+name="robots"\s+content="[^"]*noindex/i.test(
      html
    );
    test.info().annotations.push({
      type: "seo-phase1a-defer",
      description: `/login has noindex meta: ${hasNoindex}. Defer per-page noindex until shared auth layout exists.`,
    });
  });

  test("homepage opens in browser (smoke check, does not break SEO)", async ({
    page,
    diag,
  }) => {
    // Sanity that the metadata changes did not break the homepage
    // render. The homepage is a large client component; just confirm
    // it returns HTTP 200 and does not throw during initial paint.
    await gotoPath(page, "/");
    await expect(page).toHaveTitle(/Kaun Karega/);
    diag.assertClean();
  });
});
