import type { Metadata } from "next";
import Link from "next/link";

import Breadcrumbs from "@/components/landing/Breadcrumbs";
import { buildBreadcrumbSchema } from "@/lib/seo/schema";
import { listServiceContent } from "@/lib/seo/serviceContent";

/**
 * /services — catalog index for the Phase 2.0b pilot service pages.
 *
 * Server component. Lists the 5 hand-authored services, each
 * linking to /services/[slug]. The catalog itself is always
 * indexable and always in the sitemap — sub-pages may be gated by
 * provider density, but the catalog is a stable entry point.
 *
 * Privacy: never lists individual providers. Counts are not shown
 * on this page; the per-category page (where the count exists in
 * a content-specific context) is where the "X verified providers"
 * line surfaces.
 */

const SITE_URL = "https://kaunkarega.com";

const PAGE_TITLE = "Services in Jodhpur";
const PAGE_DESCRIPTION =
  "Browse local service categories on Kaun Karega — electrician, plumber, AC repair, carpenter, and painter services across Jodhpur. Post your task and get matched with verified providers.";

export const metadata: Metadata = {
  title: PAGE_TITLE,
  description: PAGE_DESCRIPTION,
  alternates: {
    canonical: "/services",
  },
  openGraph: {
    type: "website",
    url: `${SITE_URL}/services`,
    title: `${PAGE_TITLE} | Kaun Karega`,
    description: PAGE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: `${PAGE_TITLE} | Kaun Karega`,
    description: PAGE_DESCRIPTION,
  },
};

export default function ServicesCatalogPage() {
  const services = listServiceContent();

  const breadcrumbItems = [
    { name: "Home", href: "/" },
    { name: "Services", href: "/services" },
  ] as const;

  const breadcrumbSchema = buildBreadcrumbSchema(
    breadcrumbItems.map((c) => ({ name: c.name, url: c.href }))
  );

  return (
    <main className="mx-auto max-w-3xl px-4 py-8 md:py-12">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />

      <Breadcrumbs items={breadcrumbItems} className="mb-4" />

      <header>
        <h1
          data-testid="services-index-h1"
          className="text-3xl font-bold text-[#003d20] md:text-4xl"
        >
          Services in Jodhpur
        </h1>
        <p className="mt-3 text-sm leading-7 text-slate-700 md:text-base">
          Kaun Karega helps you find verified local service providers
          across Jodhpur. Browse the categories below to see what each
          service covers, or use the search at the top of the homepage
          to post your task directly.
        </p>
      </header>

      <section
        aria-labelledby="services-list-heading"
        className="mt-8"
      >
        <h2
          id="services-list-heading"
          className="text-xs font-bold uppercase tracking-widest text-[#003d20]"
        >
          Popular services
        </h2>
        <ul
          data-testid="services-index-list"
          className="mt-3 grid gap-3 sm:grid-cols-2"
        >
          {services.map((service) => (
            <li key={service.slug}>
              <Link
                href={`/services/${service.slug}`}
                data-testid={`services-index-link-${service.slug}`}
                className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-orange-600/40 hover:shadow-md md:p-5"
              >
                <p className="text-base font-bold text-[#003d20] md:text-lg">
                  {service.canonicalName}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  {service.shortIntro}
                </p>
                <p className="mt-3 inline-flex items-center text-xs font-semibold text-orange-600">
                  View {service.canonicalName.toLowerCase()} details &rarr;
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-10 rounded-2xl border border-slate-200 bg-slate-50 p-5 text-center md:p-6">
        <h2 className="text-lg font-bold text-[#003d20] md:text-xl">
          Need something else?
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-700 md:text-base">
          Post your task on the homepage and we&apos;ll match you with
          local providers in Jodhpur — even for services that don&apos;t
          have a dedicated page yet.
        </p>
        <Link
          href="/"
          data-testid="services-index-home-cta"
          className="mt-4 inline-flex items-center justify-center rounded-xl bg-[#003d20] px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-[#002a16] md:text-base"
        >
          Post your task on Kaun Karega
        </Link>
      </section>
    </main>
  );
}
