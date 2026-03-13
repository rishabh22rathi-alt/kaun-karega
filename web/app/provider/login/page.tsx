import Link from "next/link";

export default function ProviderLoginPage() {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Provider Login</h1>
        <p className="mt-2 text-sm text-slate-600">
          Continue with OTP login to access your provider dashboard.
        </p>
        <Link
          href="/login?next=/provider/dashboard"
          className="mt-5 inline-flex rounded-full bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600"
        >
          Continue to Login
        </Link>
      </div>
    </main>
  );
}
