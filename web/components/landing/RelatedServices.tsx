import Link from "next/link";

import { getServiceBySlug } from "@/lib/seo/slugs";

/**
 * "Related services" chip strip for service landing pages.
 *
 * Renders only slugs that are in the allow-list (resolved via
 * `getServiceBySlug`). Unknown slugs are silently dropped — the
 * caller's `serviceContent.relatedServiceSlugs` is supposed to be
 * sanitised by the spec, but this defence-in-depth filter means a
 * future content edit that introduces a typo can never ship a
 * broken /services link.
 */

type Props = {
  slugs: readonly string[];
  className?: string;
};

export default function RelatedServices({ slugs, className }: Props) {
  const resolved = slugs
    .map((slug) => getServiceBySlug(slug))
    .filter((entry): entry is NonNullable<ReturnType<typeof getServiceBySlug>> =>
      entry !== null
    );

  if (resolved.length === 0) return null;

  return (
    <section
      aria-labelledby="related-services-heading"
      data-testid="landing-related-services"
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6 ${
        className ?? ""
      }`}
    >
      <h2
        id="related-services-heading"
        className="text-xl font-bold text-[#003d20] md:text-2xl"
      >
        Related services in Jodhpur
      </h2>
      <ul className="mt-4 flex flex-wrap gap-2">
        {resolved.map((service) => (
          <li key={service.slug}>
            <Link
              href={`/services/${service.slug}`}
              className="inline-flex items-center rounded-full border border-orange-600/30 bg-orange-50/40 px-4 py-2 text-sm font-semibold text-[#003d20] transition hover:border-orange-600/50 hover:bg-orange-50"
            >
              {service.canonical}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
