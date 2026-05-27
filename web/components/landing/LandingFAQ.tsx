/**
 * Visible FAQ list for service landing pages.
 *
 * Uses the native <details>/<summary> disclosure pattern so the
 * answers are collapsed by default on mobile but available to
 * Googlebot in the initial HTML (the FAQPage rich-result guidelines
 * accept hidden-by-default answers as long as they are in the DOM).
 *
 * The matching FAQPage JSON-LD is emitted by the consuming page via
 * `lib/seo/schema.ts#buildFAQSchema` so this component stays
 * presentation-only.
 */

import type { FaqEntry } from "@/lib/seo/serviceContent";

type Props = {
  items: readonly FaqEntry[];
  headingId?: string;
  className?: string;
};

export default function LandingFAQ({ items, headingId, className }: Props) {
  if (items.length === 0) return null;
  const labelId = headingId ?? "landing-faq-heading";
  return (
    <section
      aria-labelledby={labelId}
      data-testid="landing-faq"
      className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6 ${
        className ?? ""
      }`}
    >
      <h2
        id={labelId}
        className="text-xl font-bold text-[#003d20] md:text-2xl"
      >
        Frequently asked questions
      </h2>
      <ul className="mt-4 divide-y divide-slate-100">
        {items.map((item, index) => (
          <li key={`${index}-${item.q}`} className="py-1">
            <details className="group py-2">
              <summary className="cursor-pointer list-none text-sm font-semibold text-slate-900 marker:hidden md:text-base">
                <span className="mr-2 text-[#003d20]" aria-hidden="true">
                  +
                </span>
                {item.q}
              </summary>
              <p className="mt-2 pl-5 text-sm leading-6 text-slate-600 md:text-base md:leading-7">
                {item.a}
              </p>
            </details>
          </li>
        ))}
      </ul>
    </section>
  );
}
