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

  test("Phase 1-B — initial HTML contains visible H1 mentioning Jodhpur", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/"));
    const html = await res.text();
    // The server-rendered SEO band exposes an <h1 data-testid="kk-home-seo-h1">.
    // It must be present in the FIRST byte stream (no JS execution
    // required) and mention "Jodhpur" so Google sees the geo signal.
    expect(html).toMatch(
      /<h1[^>]+data-testid="kk-home-seo-h1"[^>]*>[^<]*Jodhpur[^<]*<\/h1>/i
    );
  });

  test("Phase 1-B — initial HTML lists popular service keywords", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/"));
    const html = await res.text();
    // These are the canonical service names surfaced by the SSR popular-
    // services list. At least 8 of them must appear so Google's
    // categorisation of the page captures the breadth of local services
    // we cover. The full list is defined in app/page.tsx POPULAR_SERVICES.
    const required = [
      "Electrician",
      "Plumber",
      "AC Repair",
      "Carpenter",
      "Painter",
      "Tutor",
      "Tailor",
      "Photographer",
    ];
    for (const name of required) {
      expect(
        html,
        `homepage initial HTML must contain "${name}"`
      ).toContain(name);
    }
  });

  test("Phase 1-B — homepage does NOT show a visible brand-variant sentence", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/"));
    const html = await res.text();
    // Per the Phase 1-B correction: the visible "People also search for"
    // sentence was removed because it read as brand-anxiety copy. The
    // typo coverage now lives ONLY in the Organization.alternateName
    // JSON-LD asserted by a separate test below. This guard prevents a
    // future commit from accidentally re-introducing the visible line.
    expect(html).not.toMatch(/People also search for/i);
    expect(html).not.toContain('data-testid="kk-home-seo-brand-variants"');
  });

  test("Phase 1-B — SEO footer band has its core testids", async ({
    request,
  }) => {
    const res = await request.get(appUrl("/"));
    const html = await res.text();
    // Hard-pin the structural anchors so a future refactor (e.g. splitting
    // the section into a separate component) can't silently drop them.
    // The brand-variant testid is intentionally absent — see the
    // "does NOT show a visible brand-variant sentence" test above.
    expect(html).toContain('data-testid="kk-home-seo-h1"');
    expect(html).toContain('data-testid="kk-home-seo-intro"');
    expect(html).toContain('data-testid="kk-home-seo-popular-list"');
  });

  test("Phase 1-B — provider CTA copy is Devanagari-localised (not duplicated)", async ({
    request,
  }) => {
    // The dark "For Service Providers" section in HomePageClient.tsx
    // was refreshed again — this time in Hindi (Devanagari) so local
    // Jodhpur providers feel directly addressed in their own
    // language. Only ONE provider CTA ships — the duplicate guard at
    // the bottom of this test enforces that contract. Every prior
    // English-only and Hinglish-romanised intermediate copy is
    // asserted absent below so a future commit can't silently revert
    // to an older voice.
    //
    // Note: SSR HTML carries Devanagari characters as raw UTF-8 (Next
    // sets <meta charset="utf-8">), so substring matching on the
    // literal characters is the correct way to assert presence.
    const res = await request.get(appUrl("/"));
    const html = await res.text();

    // ── Positive copy assertions — the new Devanagari strings ──
    // Eyebrow label — the visual is uppercased via CSS, but the
    // literal HTML text is "For Service Providers". A case-
    // insensitive regex passes either form so a future commit that
    // drops the CSS `uppercase` and writes the label in all-caps
    // directly is also accepted.
    expect(html).toMatch(/for service providers/i);
    // Heading refreshed to the "बनिए उस सवाल का जवाब, जब कोई पूछे —
    // ये काम कौन करेगा?" two-line form. Asserting each line
    // separately (instead of the full concatenated string) tolerates
    // the inline <br /> between them without making the regex
    // sensitive to surrounding whitespace.
    expect(html).toContain("बनिए उस सवाल का जवाब");
    expect(html).toContain("ये काम कौन करेगा?");
    // Phase 1-B styling refinement: the city name "जोधपुर" is wrapped
    // in an emphasis <span> (text-lg/sm:text-xl + orange-400 +
    // semibold). "वासी" is a separate run. Asserting both words
    // individually (rather than the previous concatenated
    // "जोधपुरवासी") pins the split.
    expect(html).toContain("जोधपुर");
    expect(html).toContain("वासी");
    expect(html).toContain("आपके हुनर");
    expect(html).toContain("रोज़ाना");
    expect(html).toContain("आपको ढूंढ न पा रहे");
    // Brand-orange in-line highlight on "Kaun Karega" was added in
    // the second paragraph. The substring appears elsewhere on the
    // page too (JSON-LD `name` / `<title>`), so this assertion is a
    // presence check, not an in-CTA-only one.
    expect(html).toContain("Kaun Karega");
    expect(html).toContain("Jodhpur"); // still in title/JSON-LD
    expect(html).toContain("Register as Provider");
    // Bullet copy mixes English platform-mechanics with Hindi action
    // labels. Pin both shapes so a copy edit can't silently collapse
    // one direction.
    expect(html).toContain("Free registration to start");
    expect(html).toContain("अपनी सर्विस और एरिया चुनें");
    expect(html).toContain("लोकल ग्राहकों से काम की रिक्वेस्ट पाएं");
    expect(html).toContain("Leads को provider dashboard से manage करें");

    // ── Negative guards — every prior shipped copy variant ──
    // English-only headings + bullets.
    expect(html).not.toContain("Grow your business with Kaun Karega");
    expect(html).not.toContain("List your service business");
    expect(html).not.toContain("Zero upfront cost or commission");
    expect(html).not.toContain("Customers come to you — no cold calling");
    expect(html).not.toContain("Choose your service area");
    // Hinglish-romanised intermediate variant.
    expect(html).not.toContain("Kya aap koi kaam ya service karte hain?");
    expect(html).not.toContain("Apni service aur area choose karein");
    // Earlier Devanagari variant where the city + "वासी" were
    // concatenated. The styling refinement explicitly splits them so
    // "जोधपुर" can carry its own emphasis. Pin the split.
    expect(html).not.toContain("जोधपुरवासी");
    // Prior heading copy was the direct question "क्या आप कोई काम...".
    // The new heading reframes it as an aspiration ("बनिए उस सवाल का
    // जवाब..."). Pin that the reframing stuck.
    expect(html).not.toContain("क्या आप कोई काम, हुनर या सर्विस करते हैं?");

    // Exactly one CTA button to /provider/register should appear in
    // the homepage HTML (this section's button). A second occurrence
    // would mean a duplicate CTA was added somewhere else.
    const registerOccurrences = html.split("Register as Provider").length - 1;
    expect(
      registerOccurrences,
      `expected exactly 1 "Register as Provider" CTA, got ${registerOccurrences}`
    ).toBe(1);
  });

  test("Organization JSON-LD lists curated brand alternateNames", async ({
    request,
  }) => {
    // Phase 1-A.1 micro-patch — alternateName helps Google's Knowledge
    // Panel associate natural search variants with the canonical brand.
    // The accepted list is small and curated; the rejected list below
    // is asserted absent so a future commit cannot quietly inflate the
    // array with low-quality typos that would discount the whole JSON-LD.
    const res = await request.get(appUrl("/"));
    const html = await res.text();

    expect(html).toMatch(/"alternateName"\s*:\s*\[/);
    for (const accepted of [
      "Kon Karega",
      "Kaun Krega",
      "KaunKarega",
      "कौन करेगा",
      "Konkrega",
    ]) {
      expect(
        html,
        `alternateName must include "${accepted}"`
      ).toContain(accepted);
    }

    // Guardrail — these variants are explicitly excluded per the
    // brand-typo plan. Rough misspellings dilute the alternateName
    // quality signal; double-compressed forms and letter-swaps are
    // already handled by Google's spell-correction.
    for (const rejected of [
      "konkayega",
      "kankrega",
      "kaunkaregaa",
      "Kon Krega",
      "Koun Karega",
    ]) {
      expect(
        html,
        `alternateName must NOT include "${rejected}"`
      ).not.toContain(rejected);
    }
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
    //
    // Same anonymous-visitor whoami-401 noise that e2e/public/home.spec.ts
    // allowlists — the disclaimer bootstrap in HomePageClient.tsx
    // legitimately probes /api/auth/whoami on mount. The 401 is the
    // expected unauthenticated response; the hook short-circuits.
    // Whether the 401 lands inside the test's console capture window
    // depends on dev-server warmth + Playwright timing, so the test
    // was previously flake-sensitive. Allow-listing locks it down.
    diag.allowConsoleError(/Failed to load resource.*401/);
    diag.allowHttpError(/whoami/);
    await gotoPath(page, "/");
    await expect(page).toHaveTitle(/Kaun Karega/);
    diag.assertClean();
  });
});
