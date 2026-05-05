import Link from "next/link";

// Public pause for the I-Need feature ("Jodhpur ko chahiye"). The full
// feature implementation is preserved at app/i-need/page.tsx.bak (and the
// matching .bak files under post/, my-needs/, respond/, chat/) so the
// flow can be re-enabled without re-writing it. Re-enable by:
//   1. Renaming each page.tsx.bak back to page.tsx (overwriting the
//      Launching Soon stub).
//   2. Restoring the original Sidebar block in components/Sidebar.tsx
//      (search for "Launching Soon" markers).
// All Supabase tables, /api/kk need_chat_* intercepts, and need_chat code
// remain in place — only the public UI is paused.

export const metadata = {
  title: "Jodhpur ko chahiye — Launching Soon | Kaun Karega",
  description:
    "Jodhpur ko chahiye is launching soon. Use Kaun Karega to find a service provider near you right now.",
};

export default function INeedLaunchingSoonPage() {
  return (
    <main className="min-h-screen bg-[#FFE3C2]">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center px-5 py-12 text-center">
        <span className="inline-flex items-center gap-2 rounded-full border border-[#003d20]/15 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-[#003d20]">
          <span className="h-1.5 w-1.5 rounded-full bg-orange-500" />
          Coming Soon
        </span>

        <h1 className="mt-6 text-3xl font-extrabold tracking-tight text-[#003d20] sm:text-4xl">
          Jodhpur ko chahiye
        </h1>

        <p className="mt-4 text-2xl font-bold text-orange-500 sm:text-3xl">
          Launching Soon
        </p>

        <Link
          href="/"
          className="mt-8 inline-flex items-center justify-center rounded-xl bg-orange-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-orange-600 active:scale-95 sm:text-base"
        >
          Find a Service Now
        </Link>
      </div>
    </main>
  );
}
