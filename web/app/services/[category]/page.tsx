import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import Breadcrumbs, {
  type BreadcrumbCrumb,
} from "@/components/landing/Breadcrumbs";
import LandingFAQ from "@/components/landing/LandingFAQ";
import RelatedServices from "@/components/landing/RelatedServices";
import {
  getServiceLandingDecision,
  type LandingDecision,
} from "@/lib/seo/landingPageData";
import {
  buildBreadcrumbSchema,
  buildFAQSchema,
  buildServiceSchema,
} from "@/lib/seo/schema";
import {
  getServiceContent,
  type ServiceContent,
} from "@/lib/seo/serviceContent";
import { listAllowedServices } from "@/lib/seo/slugs";

/**
 * /services/[category] — dynamic service landing page.
 *
 * Server component. Every request flows through three phases:
 *
 *   1. Slug + density gate via getServiceLandingDecision():
 *        notfound  → notFound() → real 404
 *        noindex   → render full page, robots noindex,nofollow
 *        indexable → render full page, robots index,follow
 *
 *   2. Metadata via generateMetadata(): title/description/canonical
 *      from the hand-authored content; robots gate from the same
 *      decision.
 *
 *   3. Render via the default export: same content block in both
 *      indexable and noindex statuses. Only difference is the
 *      visible "X verified providers active" line, which is shown
 *      only when indexable (≥10) to avoid overpromising on a thin
 *      catalogue.
 *
 * Privacy guarantee: this page never reads, references, or surfaces
 * any individual provider field. The only DB-derived value is the
 * aggregate count, and even that is hidden in the noindex variant.
 * No phone, no name, no provider_id, no area row appears in HTML.
 */

const SITE_URL = "https://kaunkarega.com";

type PageProps = {
  params: Promise<{ category: string }>;
};

/**
 * Pre-generate static params at build time for the allow-list. Any
 * other slug will 404 at request time via the gate inside the page.
 */
export function generateStaticParams() {
  return listAllowedServices().map((service) => ({ category: service.slug }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { category: slug } = await params;
  const decision = await getServiceLandingDecision(slug);

  if (decision.status === "notfound") {
    // 404s get the default metadata from app/layout.tsx — title
    // template will produce "Page not found | Kaun Karega" if Next
    // routes to the global 404. Returning an empty object lets the
    // root metadata cascade unchanged.
    return {};
  }

  const content = getServiceContent(decision.slug);
  if (!content) {
    return {};
  }

  const isIndexable = decision.status === "indexable";
  const canonicalPath = `/services/${decision.slug}`;

  return {
    title: `${content.canonicalName} in Jodhpur`,
    description: content.shortIntro,
    alternates: {
      canonical: canonicalPath,
    },
    robots: isIndexable
      ? {
          index: true,
          follow: true,
          googleBot: {
            index: true,
            follow: true,
            "max-image-preview": "large",
            "max-snippet": -1,
          },
        }
      : {
          index: false,
          follow: false,
          nocache: true,
          googleBot: {
            index: false,
            follow: false,
            noimageindex: true,
          },
        },
    openGraph: {
      type: "website",
      url: `${SITE_URL}${canonicalPath}`,
      title: `${content.canonicalName} in Jodhpur | Kaun Karega`,
      description: content.shortIntro,
    },
    twitter: {
      card: "summary_large_image",
      title: `${content.canonicalName} in Jodhpur | Kaun Karega`,
      description: content.shortIntro,
    },
  };
}

export default async function ServiceCategoryPage({ params }: PageProps) {
  const { category: slug } = await params;
  const decision = await getServiceLandingDecision(slug);

  if (decision.status === "notfound") {
    notFound();
  }

  const content = getServiceContent(decision.slug);
  if (!content) {
    // Belt-and-braces: this should never trigger because the
    // landing decision only resolves slugs in the allow-list, and
    // every allow-list slug has content. If it ever does (e.g.
    // content was deleted in a PR), fail closed with 404 rather
    // than render a half-empty page.
    notFound();
  }

  return (
    <CategoryPageRender decision={decision} content={content} />
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Render
// ─────────────────────────────────────────────────────────────────────

type RenderProps = {
  // Excludes "notfound" — the default export already short-circuits
  // for that status, so the renderer only sees the two render paths.
  decision: Extract<LandingDecision, { status: "indexable" | "noindex" }>;
  content: ServiceContent;
};

function CategoryPageRender({ decision, content }: RenderProps) {
  const breadcrumbItems: readonly BreadcrumbCrumb[] = [
    { name: "Home", href: "/" },
    { name: "Services", href: "/services" },
    {
      name: content.canonicalName,
      href: `/services/${content.slug}`,
    },
  ];

  // Build all three JSON-LD nodes up front. Both indexable and
  // noindex variants emit the same schemas — if a noindex page
  // ever flips to indexable later (count rose past threshold),
  // Google can use the cached schema without a fresh crawl pass.
  const breadcrumbSchema = buildBreadcrumbSchema(
    breadcrumbItems.map((c) => ({ name: c.name, url: c.href }))
  );
  const serviceSchema = buildServiceSchema({
    canonicalName: content.canonicalName,
    description: content.shortIntro,
    url: `/services/${content.slug}`,
  });
  const faqSchema = buildFAQSchema(content.faq);

  const isIndexable = decision.status === "indexable";
  const ctaHref = `/?category=${encodeURIComponent(content.canonicalName)}`;

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      {/* Schemas inlined as <script> so Googlebot reads them on
          first render — no deferred Script component. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(serviceSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
      />

      <Breadcrumbs items={breadcrumbItems} className="mb-4" />

      <header>
        <h1
          data-testid="service-landing-h1"
          className="text-3xl font-bold text-[#003d20] md:text-4xl"
        >
          {content.h1}
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-700 md:text-base">
          {content.shortIntro}
        </p>

        {/* Provider-count line — only shown for indexable pages so
            we don't advertise a low number on noindex pages where
            density is still growing. Honest framing, no inflation. */}
        {isIndexable ? (
          <p
            data-testid="service-landing-count"
            className="mt-4 inline-flex items-center rounded-full bg-[#003d20]/10 px-4 py-2 text-sm font-semibold text-[#003d20] md:text-base"
          >
            {decision.providerCount} verified providers active across
            Jodhpur right now
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={ctaHref}
            data-testid="service-landing-cta-post"
            className="inline-flex items-center justify-center rounded-xl bg-[#003d20] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a16] md:text-base"
          >
            Post your task for {content.canonicalName}
          </Link>
          <Link
            href="/services"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-[#003d20] transition hover:bg-slate-50 md:text-base"
          >
            All services
          </Link>
        </div>
      </header>

      {/* Service description */}
      <section
        aria-labelledby="service-description-heading"
        className="mt-8"
      >
        <h2
          id="service-description-heading"
          className="text-xl font-bold text-[#003d20] md:text-2xl"
        >
          About {content.canonicalName.toLowerCase()} work in Jodhpur
        </h2>
        <p className="mt-3 text-sm leading-7 text-slate-700 md:text-base md:leading-8">
          {content.description}
        </p>
      </section>

      {/* Common jobs */}
      {content.commonJobs.length > 0 ? (
        <section
          aria-labelledby="common-jobs-heading"
          className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6"
        >
          <h2
            id="common-jobs-heading"
            className="text-xl font-bold text-[#003d20] md:text-2xl"
          >
            Common {content.canonicalName.toLowerCase()} jobs
          </h2>
          <ul
            data-testid="service-landing-common-jobs"
            className="mt-3 grid gap-2 sm:grid-cols-2"
          >
            {content.commonJobs.map((job) => (
              <li
                key={job}
                className="flex items-start gap-2 text-sm text-slate-700 md:text-base"
              >
                <span aria-hidden="true" className="mt-0.5 text-orange-500">
                  &#10003;
                </span>
                <span>{job}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* How it works */}
      <section
        aria-labelledby="how-it-works-heading"
        className="mt-8"
      >
        <h2
          id="how-it-works-heading"
          className="text-xl font-bold text-[#003d20] md:text-2xl"
        >
          How Kaun Karega works
        </h2>
        <ol className="mt-4 grid gap-4 sm:grid-cols-3">
          {[
            {
              step: "1",
              title: "Tell us what you need",
              body: `Post the task and your Jodhpur area in under a minute.`,
            },
            {
              step: "2",
              title: "We match you with local providers",
              body: `Verified ${content.canonicalName.toLowerCase()}s in your area are notified.`,
            },
            {
              step: "3",
              title: "Connect on WhatsApp",
              body: `Chat directly with providers and confirm the job.`,
            },
          ].map((step) => (
            <li
              key={step.step}
              className="rounded-2xl border border-slate-200 bg-white p-5 text-center shadow-sm"
            >
              <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#003d20] text-sm font-bold text-white">
                {step.step}
              </span>
              <p className="mt-3 text-sm font-bold text-slate-900">
                {step.title}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                {step.body}
              </p>
            </li>
          ))}
        </ol>
      </section>

      {/* FAQ */}
      <div className="mt-8">
        <LandingFAQ items={content.faq} />
      </div>

      {/* Related services */}
      <div className="mt-8">
        <RelatedServices slugs={content.relatedServiceSlugs} />
      </div>

      {/* Final CTA */}
      <section className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center md:p-6">
        <h2 className="text-lg font-bold text-[#003d20] md:text-xl">
          Ready to get your {content.canonicalName.toLowerCase()} task done?
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-700 md:text-base">
          Post your task in under a minute and get matched with local
          providers in Jodhpur.
        </p>
        <Link
          href={ctaHref}
          className="mt-4 inline-flex items-center justify-center rounded-xl bg-[#003d20] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a16] md:text-base"
        >
          Post your task for {content.canonicalName}
        </Link>
      </section>
    </main>
  );
}
