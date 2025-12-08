"use client";

import { Suspense, useEffect, useMemo, useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type UserStatus = "provider" | "receiver" | "new";

export default function OtpPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-10">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-lg p-8 text-sm text-slate-700">
            Loading OTP form...
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
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState("");

  const phoneDigits = useMemo(() => phone.replace(/\D/g, "").slice(0, 10), [phone]);
  const redirectTo = searchParams.get("redirectTo") || "";

  useEffect(() => {
    if (typeof window !== "undefined") {
      const role = localStorage.getItem("kk_user_role");
      if (role === "provider") {
        router.replace(redirectTo || "/dashboard");
        return;
      }
      if (role === "receiver") {
        router.replace(redirectTo || "/");
        return;
      }
    }

    const initialPhone = searchParams.get("phone");
    if (initialPhone) {
      setPhone(initialPhone);
      return;
    }
    if (typeof window === "undefined") return;
    const cached =
      localStorage.getItem("kk_last_phone") || localStorage.getItem("kk_user_phone");
    if (cached) {
      setPhone(cached);
    }
  }, [router, searchParams, redirectTo]);

  const persistSession = (status: UserStatus, digits: string) => {
    if (typeof window === "undefined") return;
    const normalized = digits.length === 10 ? `91${digits}` : digits;
    localStorage.setItem("kk_user_role", status);
    localStorage.setItem("kk_user_phone", normalized);
    localStorage.setItem("kk_last_phone", digits);
    if (status === "provider") {
      localStorage.setItem("kk_provider_id", normalized);
    } else {
      localStorage.removeItem("kk_provider_id");
    }
    const token = btoa(
      JSON.stringify({ role: status, phone: normalized, ts: Date.now() })
    );
    localStorage.setItem("kk_auth_token", token);
  };

  const handleVerify = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setInfo("");

    if (phoneDigits.length !== 10) {
      setError("Enter a valid 10-digit mobile number");
      return;
    }
    if (!/^\d{4}$/.test(otp)) {
      setError("Enter the 4-digit OTP sent on WhatsApp");
      return;
    }

    setLoading(true);
    try {
      const verifyRes = await fetch("/api/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phoneDigits, otp }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok || !verifyData.ok) {
        setError(verifyData.error || "Invalid OTP");
        return;
      }

      const statusRes = await fetch(
        `/api/check-user-status?phone=${encodeURIComponent(phoneDigits)}`,
        { cache: "no-store" }
      );
      const statusData = await statusRes.json();
      if (!statusRes.ok || !statusData.status) {
        setError(statusData.error || "Could not check account status");
        return;
      }

      const status: UserStatus = statusData.status;
      persistSession(status, phoneDigits);

      if (redirectTo) {
        router.push(redirectTo);
        return;
      }

      if (status === "provider") {
        router.replace("/dashboard");
      } else if (status === "receiver") {
        router.replace("/");
      } else {
        router.replace(`/choose-role?phone=${phoneDigits}`);
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
        <header className="text-center space-y-1">
          <p className="text-xs uppercase tracking-wide text-[#0EA5E9]">OTP Verification</p>
          <h1 className="text-2xl font-bold text-slate-900">Enter the 4-digit code</h1>
          <p className="text-sm text-slate-600">Sent to {phoneDigits || "your number"}</p>
        </header>

        {(error || info) && (
          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              error
                ? "border-red-200 bg-red-50 text-red-700"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}
          >
            {error || info}
          </div>
        )}

        <form className="space-y-4" onSubmit={handleVerify}>
          <div className="space-y-1">
            <label className="text-sm font-semibold text-slate-700">OTP</label>
            <input
              type="tel"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))}
              className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-lg tracking-[0.25em] shadow-sm focus:border-[#0EA5E9] focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]/30"
              placeholder="______"
              inputMode="numeric"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full bg-[#0EA5E9] px-4 py-3 text-white font-semibold shadow-md transition hover:shadow-lg disabled:opacity-60"
          >
            {loading ? "Verifying..." : "Verify OTP"}
          </button>
        </form>
      </div>
    </main>
  );
}
