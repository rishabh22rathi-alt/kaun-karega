"use client";
import { Suspense, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

const DEFAULT_NEXT = "/";

const getSafeNext = (value: string | null): string => {
  if (!value) return DEFAULT_NEXT;
  if (!value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_NEXT;
  }
  return value;
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 px-4 py-10">
          <div className="mx-auto flex min-h-[calc(100vh-5rem)] w-full max-w-md items-center justify-center">
            <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-lg md:p-8">
              Loading login...
            </div>
          </div>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const searchParams = useSearchParams();
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const lastSentAtRef = useRef(0);
  const nextPath = getSafeNext(searchParams.get("next"));

  async function handleLogin(e: any) {
    e.preventDefault();

    if (loading) return;
    const now = Date.now();
    if (now - lastSentAtRef.current < 1500) return;
    lastSentAtRef.current = now;

    const normalized = phone.replace(/\D/g, "");
    if (normalized.length !== 10) {
      setError("Enter a valid 10-digit number");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const requestId = crypto.randomUUID();
      const res = await fetch("/api/send-whatsapp-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ phoneNumber: normalized, requestId }),
      });

      let data: any;
      try {
        data = await res.json();
      } catch (parseError) {
        console.error("OTP API non-JSON response", {
          status: res.status,
        });
        setError("OTP service failed. Check server logs.");
        return;
      }

      if (!res.ok || data?.ok === false) {
        console.error("OTP request failed", { status: res.status, data });
        setError(
          data?.error || data?.message || "Something went wrong. Try again."
        );
        return;
      }

      if (data?.ok) {
        window.location.href = `/verify?phone=${normalized}&requestId=${encodeURIComponent(
          requestId
        )}&next=${encodeURIComponent(nextPath)}`;
      } else {
        setError(data?.message || "Something went wrong. Try again.");
      }
    } catch (error) {
      console.error("OTP request crashed", error);
      setError("Something went wrong. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 pb-10 pt-[9vh] sm:pt-[11vh] lg:pt-[12vh]">
      <div className="mx-auto flex w-full max-w-md justify-center">
      <form
        onSubmit={handleLogin}
        className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-lg md:p-8"
        aria-label="Phone verification form"
      >
        <div className="mb-6 text-center">
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight leading-tight">
            <span className="text-[#003d20]">Kaun</span>{" "}
            <span className="text-orange-600">Karega</span>
          </h1>
          <p className="mt-1 text-base md:text-lg text-slate-500 font-medium">
            Trusted local help in minutes
          </p>
          <h1 className="mt-4 text-2xl font-semibold text-[#003d20]">
            Verify your phone
          </h1>
          <p className="mt-2 text-sm text-slate-600">
            We&rsquo;ll send an OTP on WhatsApp to continue.
          </p>
        </div>

        <div className="space-y-2">
          <label
            htmlFor="phone"
            className="block text-sm font-medium text-slate-700"
          >
            Phone number
          </label>
          <input
            id="phone"
            name="phone"
            type="tel"
            maxLength={10}
            placeholder="Enter 10-digit WhatsApp number"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
              if (error) setError("");
            }}
            disabled={loading}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="tel-national"
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500/25 disabled:cursor-not-allowed disabled:bg-slate-100"
            aria-describedby="phone-helper"
          />
          <p id="phone-helper" className="text-xs text-slate-500">
            Enter the same number you use on WhatsApp.
          </p>
        </div>

        {error && (
          <p
            className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="mt-5 inline-flex w-full items-center justify-center rounded-xl bg-[#003d20] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#00542b] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Sending..." : "Send OTP"}
        </button>
      </form>
      </div>
    </div>
  );
}
