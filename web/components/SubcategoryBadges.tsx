import { ChevronRight } from "lucide-react";

type SubcategoryBadgesProps = {
  items?: string[];
  title?: string;
};

const DEFAULT_ITEMS = [
  "Wedding Photographer",
  "Candid Photographer",
  "Event Photographer",
  "Party Photographer",
  "Baby Photographer",
];

export default function SubcategoryBadges({
  items = DEFAULT_ITEMS,
  title = "Suggested sub-categories",
}: SubcategoryBadgesProps) {
  return (
    <section className="w-full rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm">
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <ul className="mt-3 space-y-2">
        {items.map((item) => (
          <li
            key={item}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-800"
          >
            <span>{item}</span>
            <ChevronRight className="h-4 w-4 text-slate-400" />
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="mt-4 w-full rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
      >
        View All
      </button>
    </section>
  );
}
