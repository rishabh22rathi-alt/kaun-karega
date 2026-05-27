import HomePageClient from "./HomePageClient";

/**
 * Homepage — SEO Phase 1-B server wrapper.
 *
 * The interactive homepage (1,800+ LoC of category search, area picker,
 * task submission, disclaimer modal, typewriter, etc.) lives in
 * HomePageClient.tsx as a client component. This file is a thin server
 * component whose only job is to:
 *
 *   1. Mount the client component (no behavior change to the existing
 *      task-submission flow).
 *   2. Render a visible "About Kaun Karega in Jodhpur" section in
 *      initial server-rendered HTML, BELOW the client tree.
 *
 * Why below the client and not above:
 *   The mobile-first hero (wordmark + search bar + popular chips + hero
 *   tiles) is highly tuned for above-the-fold conversion. Inserting any
 *   visible SEO band above it would push the search bar down. Placing
 *   the SEO content below preserves the existing above-the-fold
 *   experience while still emitting the H1 and service keywords in
 *   the initial HTML that Googlebot reads on first request (it does
 *   not need to JS-render to see them).
 *
 * Why not sr-only:
 *   The content here is genuinely useful (describes the platform,
 *   surfaces popular categories). Visible-and-useful beats hidden-and-
 *   keyword-stuffed on every Google quality signal that matters.
 *
 * Brand spelling variants (Kon Karega, Kaun Krega, कौन करेगा) are
 * surfaced ONLY via the curated Organization.alternateName JSON-LD in
 * app/layout.tsx — a visible "people also search for" sentence here
 * read as unprofessional brand-anxiety copy and was removed.
 *
 * No links to /services/[category] yet — those pages do not exist
 * (Phase 2). The popular-services entries are plain text chips so we
 * never ship a 404 link.
 */

// Popular services surfaced in the SEO footer block. Keep aligned with
// the TW_HINTS list inside HomePageClient.tsx so the visible chips
// (after hydration) and the SSR text mention the same canonical names.
const POPULAR_SERVICES = [
  "Electrician",
  "Plumber",
  "AC Repair",
  "Carpenter",
  "Painter",
  "Tutor",
  "Tailor",
  "Maid / Help",
  "Photographer",
  "Mehndi Artist",
  "Pre School",
  "Welder",
] as const;

export default function Home() {
  return (
    <>
      <HomePageClient />

      {/* SEO Phase 1-B — Server-rendered informational footer band.
          Visible to users on scroll. Visible to Googlebot in initial HTML.
          NOT a duplicate of the interactive hero above: this section
          describes the service in prose, lists categories as plain text
          (no links until Phase 2 landing pages exist), and clarifies
          brand-name variants. */}
      <section
        aria-labelledby="kk-home-seo-heading"
        className="border-t border-slate-200 bg-slate-100 px-4 py-12 md:py-14"
      >
        <div className="mx-auto max-w-3xl text-center">
          <h1
            id="kk-home-seo-heading"
            data-testid="kk-home-seo-h1"
            className="text-xl font-bold text-[#003d20] md:text-2xl"
          >
            Find trusted local service providers in Jodhpur
          </h1>

          <p
            data-testid="kk-home-seo-intro"
            className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-700 md:text-base md:leading-7"
          >
            Kaun Karega helps you find verified local service providers
            across Jodhpur, Rajasthan. Post any household or professional
            task — electrician, plumber, AC repair, carpenter, painter,
            tutor, tailor, maid or help, photographer, mehndi artist —
            and get connected to nearby providers on WhatsApp. Most
            providers respond the same day.
          </p>

          <div className="mt-6">
            <p className="text-[11px] font-bold uppercase tracking-widest text-[#003d20]">
              Popular services in Jodhpur
            </p>
            <ul
              data-testid="kk-home-seo-popular-list"
              className="mt-3 flex flex-wrap justify-center gap-2 text-xs text-slate-700 md:text-sm"
            >
              {POPULAR_SERVICES.map((label) => (
                <li
                  key={label}
                  className="rounded-full border border-slate-200 bg-white px-3 py-1 shadow-sm"
                >
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <p className="mt-7 text-xs text-slate-500 md:text-sm">
            Use the search at the top of the page to post your task and
            get connected to a Jodhpur service provider.
          </p>
        </div>
      </section>
    </>
  );
}
