import type { Metadata } from "next";
import { DISCLAIMER_TEXT, DISCLAIMER_VERSION } from "@/lib/disclaimer";

// Public, statically-renderable page. Renders the verbatim disclaimer
// text from the shared module so this page and the homepage modal can
// never drift out of sync. No interactivity, no auth, no data
// dependencies — safe to hit before login.

export const metadata: Metadata = {
  title: "Disclaimer · Kaun Karega",
  description:
    "How Kaun Karega connects users with independent local service providers, and what users should verify before booking work.",
};

export default function DisclaimerPage() {
  const paragraphs = DISCLAIMER_TEXT.split(/\n\n+/);
  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <header className="mb-6">
        <p className="text-xs font-bold uppercase tracking-widest text-orange-600">
          Kaun Karega
        </p>
        <h1 className="mt-1 text-2xl font-bold text-[#003d20] sm:text-3xl">
          Disclaimer
        </h1>
        <p className="mt-2 text-xs text-slate-500">
          Version {DISCLAIMER_VERSION}
        </p>
      </header>
      <article className="space-y-4 text-sm leading-7 text-slate-700">
        {paragraphs.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </article>
    </main>
  );
}
