"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const phoneDigits = useMemo(() => phone.replace(/\D/g, "").slice(0, 10), [phone]);
  const redirectTo = searchParams.get("redirectTo");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const role = localStorage.getItem("kk_user_role");
    if (role === "provider") {
      router.replace(redirectTo || "/dashboard");
    } else if (role === "receiver") {
      router.replace(redirectTo || "/");
    }
  }, [redirectTo, router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const cached = localStorage.getItem("kk_last_phone") || localStorage.getItem("kk_user_phone");
    if (cached) {
      setPhone(cached);
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    if (phoneDigits.length !== 10) {
      setError("Enter a valid 10-digit mobile number");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneDigits }),
      });

      
      
      const data = await res.json();
      console.log(res);console.log(data);
      if (!res.ok || !data.ok) {
          console.log('Response OK but data not OK');
          setError(data.error || "Failed to send OTP. Try again.");
        } else {
          console.log('OTP sent successfully');
          if (typeof window !== "undefined") {
            localStorage.setItem("kk_last_phone", phoneDigits);
          }
          const query = new URLSearchParams({ phone: phoneDigits });
          if (redirectTo) query.set("redirectTo", redirectTo);
          router.push(`/otp?${query.toString()}`);
        }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-lg p-8 space-y-6">
        <header className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-[#0EA5E9]">Login / Register</h1>
          <p className="text-slate-600 text-sm">Enter your WhatsApp number to get started.</p>
        </header>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form className="space-y-4" onSubmit={handleSubmit}>
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
            {loading ? "Sending OTP..." : "Continue"}
          </button>
        </form>
      </div>
    </main>
  );
}

