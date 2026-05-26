import Link from "next/link";
import InstallAppPromptCard from "@/components/pwa/InstallAppPromptCard";

export default function ProviderRegisterSuccessPage() {
  return (
    <div className="flex min-h-screen flex-col items-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm md:p-8">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Service Provider
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900 md:text-3xl">
          Application Submitted
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-slate-600 md:text-base">
          Application submitted (Pending approval). Our team will review your
          details and contact you on WhatsApp if needed.
        </p>

        <Link
          href="/"
          className="mx-auto mt-7 inline-flex w-full max-w-sm items-center justify-center rounded-full bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-sky-600"
        >
          Go to Home
        </Link>
      </div>

      {/* Phase 2 PWA reminder — provider just signed up; high-intent
          moment. Self-hides when installed / unsupported / dismissed
          within the 7-day cooldown. */}
      <div className="mt-4 w-full max-w-xl">
        <InstallAppPromptCard />
      </div>
    </div>
  );
}
