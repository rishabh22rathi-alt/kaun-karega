import Link from "next/link";

/**
 * Visible breadcrumb for service landing pages.
 *
 * Renders the chevron-separated trail. The matching BreadcrumbList
 * JSON-LD is emitted by the consuming page via
 * `lib/seo/schema.ts#buildBreadcrumbSchema` so this component stays
 * presentation-only — no script tag, no JSON-LD, no client-side JS.
 *
 * The current item (last entry) is rendered as plain text rather
 * than a link, matching the convention Google's
 * BreadcrumbList rich-result guidelines expect.
 */
export type BreadcrumbCrumb = {
  /** Display label for this crumb. */
  name: string;
  /** Path-relative href. The LAST crumb's href is ignored — the
   *  current page is plain text, never a link to itself. */
  href: string;
};

type Props = {
  items: readonly BreadcrumbCrumb[];
  className?: string;
};

export default function Breadcrumbs({ items, className }: Props) {
  if (items.length === 0) return null;
  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="landing-breadcrumbs"
      className={`text-xs text-slate-500 md:text-sm ${className ?? ""}`}
    >
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((crumb, index) => {
          const isLast = index === items.length - 1;
          return (
            <li key={`${crumb.href}-${index}`} className="flex items-center gap-2">
              {index > 0 ? (
                <span aria-hidden="true" className="text-slate-400">
                  ›
                </span>
              ) : null}
              {isLast ? (
                <span
                  aria-current="page"
                  className="font-semibold text-[#003d20]"
                >
                  {crumb.name}
                </span>
              ) : (
                <Link
                  href={crumb.href}
                  className="hover:text-[#003d20] hover:underline"
                >
                  {crumb.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
