"use client";

import { Suspense, useEffect, useMemo, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function ProviderRegisterPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-xl rounded-2xl bg-white shadow-lg p-8 text-sm text-slate-700">
            Loading provider registration...
          </div>
        </main>
      }
    >
      <PageContent />
    </Suspense>
  );
}

function PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [category, setCategory] = useState("");
  const [area, setArea] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const phoneDigits = useMemo(() => phone.replace(/\D/g, "").slice(0, 10), [phone]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const role = localStorage.getItem("kk_user_role");
      if (role === "provider") {
        router.replace("/dashboard");
        return;
      }
      if (role === "receiver") {
        router.replace("/");
        return;
      }
    }

    const fromQuery = searchParams.get("phone");
    if (fromQuery) {
      setPhone(fromQuery);
      return;
    }
    if (typeof window === "undefined") return;
    const cached =
      localStorage.getItem("kk_last_phone") || localStorage.getItem("kk_user_phone");
    if (cached) {
      setPhone(cached);
    }
  }, [router, searchParams]);

  const persistSession = (digits: string) => {
    if (typeof window === "undefined") return;
    const normalized = digits.length === 10 ? `91${digits}` : digits;
    localStorage.setItem("kk_user_role", "provider");
    localStorage.setItem("kk_user_phone", normalized);
    localStorage.setItem("kk_last_phone", digits);
    localStorage.setItem("kk_provider_id", normalized);
    const token = btoa(
      JSON.stringify({ role: "provider", phone: normalized, ts: Date.now() })
    );
    localStorage.setItem("kk_auth_token", token);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim() || !category.trim() || !area.trim()) {
      setError("All fields are required");
      return;
    }
    if (phoneDigits.length !== 10) {
      setError("Enter a valid 10-digit mobile number");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/register/provider", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: phoneDigits,
          category: category.trim(),
          area: area.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.error || "Unable to submit details right now.");
        return;
      }

      persistSession(phoneDigits);
      router.replace("/dashboard");
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl rounded-2xl bg-white shadow-lg p-8 space-y-6">
        <header className="space-y-2 text-center">
          <p className="text-xs uppercase tracking-wide text-[#0EA5E9]">Provider Setup</p>
          <h1 className="text-3xl font-bold text-slate-900">Create Provider Profile</h1>
          <p className="text-sm text-slate-600">Tell us what you offer and where you work.</p>
        </header>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-700">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/30"
              placeholder="Your name"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-700">Primary Category</label>
            <input
              type="text"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/30"
              placeholder="e.g., Electrician, Carpenter"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-700">Service Area</label>
            <input
              type="text"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/30"
              placeholder="Neighborhood or locality"
            />
          </div>

          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-700">Mobile Number</label>
            <input
              type="tel"
              value={phoneDigits}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/30"
              placeholder="10-digit mobile number"
              inputMode="numeric"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[#0EA5E9] px-4 py-3 text-white font-semibold shadow-md transition hover:shadow-lg disabled:opacity-60"
          >
            {loading ? "Saving..." : "Submit & Go to Dashboard"}
          </button>
        </form>
      </div>
    </main>
  );
}
