type Category = {
  title: string;
  items: { label: string; image: string }[];
  accent: string;
};

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
    title: "Events",
    items: [
      { label: "Photographers", image: "/subcategories/event-photo.svg" },
      { label: "Decorators", image: "/subcategories/event-decor.svg" },
      { label: "Caterers", image: "/subcategories/event-catering.svg" },
      { label: "DJs", image: "/subcategories/event-dj.svg" },
    ],
    accent: "bg-rose-50",
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
      </div>
    </section>
  );
}
