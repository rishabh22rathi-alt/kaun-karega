"use client";

import { useRouter } from "next/navigation";

type Category = {
  title: string;
  items: { label: string; image: string }[];
  accent: string;
};

const I_NEED_ITEMS = [
  { label: "Naukri", emoji: "💼" },
  { label: "Property", emoji: "🏗️" },
  { label: "Rent", emoji: "🏠" },
  { label: "Buy / Sell", emoji: "🤝" },
] as const;

const CATEGORIES: Category[] = [
  {
    title: "Home Services",
    items: [
      { label: "Electrician", image: "/subcategories/home-electrician.svg" },
      { label: "Plumber", image: "/subcategories/home-plumber.svg" },
      { label: "Carpenter", image: "/subcategories/home-carpenter.svg" },
      { label: "Cleaning", image: "/subcategories/home-cleaning.svg" },
    ],
    accent: "bg-amber-50",
  },
  {
    title: "Education",
    items: [
      { label: "Home Tutor", image: "/subcategories/edu-tutor.svg" },
      { label: "Play School", image: "/subcategories/edu-play.svg" },
      { label: "Tuition", image: "/subcategories/edu-tuition.svg" },
      { label: "Coaching", image: "/subcategories/edu-coaching.svg" },
    ],
    accent: "bg-sky-50",
  },
  {
    title: "Repairs & Others",
    items: [
      { label: "AC Repair", image: "/subcategories/repair-ac.svg" },
      { label: "RO Repair", image: "/subcategories/repair-ro.svg" },
      { label: "Pest Control", image: "/subcategories/repair-pest.svg" },
      { label: "Painter", image: "/subcategories/repair-paint.svg" },
    ],
    accent: "bg-emerald-50",
  },
];

export default function HomeCategoryGrid() {
  const router = useRouter();

  return (
    <section className="mb-8 w-full">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {CATEGORIES.map((category) => {
          return (
            <div
              key={category.title}
              className={`rounded-2xl ${category.accent} p-4 shadow-sm`}
            >
              <h3 className="text-sm font-semibold text-slate-900">
                {category.title}
              </h3>
              <ul className="mt-4 grid grid-cols-2 gap-3 text-xs text-slate-700">
                {category.items.map((item) => (
                  <li key={item.label} className="flex flex-col items-center">
                    <div className="h-12 w-12 rounded-full bg-white/90 p-2 shadow-sm">
                      <img
                        src={item.image}
                        alt={item.label}
                        className="h-full w-full rounded-full object-cover"
                      />
                    </div>
                    <span className="mt-2 text-center font-medium">
                      {item.label}
                    </span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="mt-4 inline-flex text-sm font-semibold text-slate-700 hover:text-slate-900"
              >
                View all
              </button>
            </div>
          );
        })}
        <div className="relative rounded-2xl bg-violet-500 p-4 shadow-md">
          <button
            type="button"
            aria-label="Open I NEED"
            onClick={() => router.push("/i-need")}
            className="absolute inset-0 z-10 rounded-2xl bg-transparent"
          >
            <span className="sr-only">Open I NEED</span>
          </button>
          <div className="flex min-h-7 items-start justify-between gap-2">
            <div>
              <span className="inline-block rounded-full bg-white/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white/80">
                Community
              </span>
              <h3 className="mt-1.5 text-base font-bold leading-tight text-white">
                I NEED
              </h3>
              <p className="mt-0.5 text-[11px] leading-snug text-violet-200">
                Post your need &amp; get responses
              </p>
            </div>
          </div>
          <ul className="mt-4 grid grid-cols-2 gap-2 text-xs">
            {I_NEED_ITEMS.map((item) => (
              <li key={item.label} className="flex flex-col items-center">
                <div className="h-12 w-12 rounded-full bg-white/15 p-2 shadow-sm ring-1 ring-white/20">
                  <div className="flex h-full w-full items-center justify-center rounded-full text-xl">
                    {item.emoji}
                  </div>
                </div>
                <span className="mt-2 text-center font-semibold text-white">
                  {item.label}
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-white">
            Post or Browse
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}
