import type { Metadata } from "next";
import Link from "next/link";

// Public provider intro / intake page — Friction Phase 2 (Option C).
//
// Guests reach this from the bottom-nav "Provider" entry and from outreach
// links (Facebook / Instagram / WhatsApp / pamphlets). It explains the
// value of a free provider profile in Hindi/Hinglish, then funnels into the
// EXISTING, still-login-gated registration via /login?next=/provider/register.
//
// Deliberately a public, static server component:
//   - collects NO data and creates NOTHING (no provider row, no session);
//   - the full /provider/register form stays login + OTP protected;
//   - the provider_register backend hardening is untouched.
// So this adds a public top-of-funnel surface without weakening any gate.

export const metadata: Metadata = {
  title: "Kaun Karega पर मुफ्त प्रोफाइल बनाएं | जोधपुर",
  description:
    "जोधपुर में अपनी सर्विस या काम की मुफ्त प्रोफाइल बनाएं ताकि ग्राहक आपको ढूंढ सकें। Kaun Karega पर प्रोफाइल बनाना बिल्कुल मुफ्त है।",
};

// The CTA intentionally points at the gated registration via login so the
// OTP funnel returns the guest to /provider/register. Matches the route
// the guest bottom-nav "Provider" entry used before this page existed.
const REGISTER_CTA_HREF = "/login?next=/provider/register";

const BENEFITS = [
  "अपनी सर्विस और काम की जानकारी जोड़ें",
  "जिस क्षेत्र में काम करते हैं, वह चुनें",
  "ग्राहक आपको ढूंढ सकें",
  "प्रोफाइल बनाना बिल्कुल मुफ्त है",
];

export default function ProviderStartPage() {
  return (
    <main
      data-testid="provider-start-page"
      className="min-h-screen bg-[#FFE3C2] px-4 py-10 sm:flex sm:items-center sm:justify-center"
    >
      <div className="mx-auto w-full max-w-xl space-y-6 rounded-2xl bg-white p-7 shadow-lg sm:p-8">
        <span className="inline-flex items-center rounded-full bg-[#003d20]/10 px-3 py-1 text-xs font-semibold text-[#003d20]">
          बिल्कुल मुफ्त · जोधपुर
        </span>

        <header className="space-y-3">
          <h1 className="text-2xl font-bold leading-snug text-[#003d20] sm:text-3xl">
            जोधपुर में लोग रोज़ अच्छे काम करने वालों को ढूंढते हैं
          </h1>
          <p className="text-sm leading-relaxed text-slate-700 sm:text-base">
            अगर आप कोई सर्विस या काम करते हैं, तो Kaun Karega पर अपनी मुफ्त
            प्रोफाइल बनाइए और अपने काम को ऑनलाइन पहचान दीजिए।
          </p>
        </header>

        <ul className="space-y-2.5">
          {BENEFITS.map((benefit) => (
            <li key={benefit} className="flex items-start gap-2.5">
              <span
                aria-hidden="true"
                className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#003d20]/10 text-xs font-bold text-[#003d20]"
              >
                ✓
              </span>
              <span className="text-sm text-slate-800">{benefit}</span>
            </li>
          ))}
        </ul>

        <p className="text-sm font-medium text-slate-600">
          नए ग्राहकों तक पहुँचने का मौका।
        </p>

        <Link
          href={REGISTER_CTA_HREF}
          data-testid="provider-start-cta"
          className="inline-flex w-full items-center justify-center rounded-xl bg-[#003d20] px-6 py-3.5 text-base font-bold text-white shadow-lg transition hover:bg-[#002a15] hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#003d20] focus-visible:ring-offset-2"
        >
          Create Free Profile
        </Link>
      </div>
    </main>
  );
}
