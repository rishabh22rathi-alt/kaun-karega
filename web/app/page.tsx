"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";

import AreaSelection from "@/app/(public)/components/AreaSelection";
import WhenNeedIt from "@/app/(public)/components/WhenNeedIt";
import logo from "@/public/kaun-karega-logo.svg";

const MASTER_AREAS = [
  "Sardarpura",
  "Shastri Nagar",
  "Ratanada",
  "Pal Road",
  "Bhagat Ki Kothi",
  "Chopasni Housing Board",
  "Chopasni Road",
  "Basni",
  "Paota",
  "Mandore",
  "Residency Road",
  "Rai Ka Bagh",
  "High Court Colony",
  "Civil Lines",
  "Kamla Nehru Nagar",
  "Kudi Bhagtasni Housing Board",
  "Banar",
  "Pratap Nagar",
  "Nayapura",
  "Shikargarh",
  "Air Force Area",
  "MIA",
  "Jalori Gate",
  "Sojati Gate",
  "Clock Tower",
  "Nandri",
  "Paota Circle",
  "Kabir Nagar",
  "Vivek Vihar",
  "BJS Colony",
  "Umaid Stadium",
  "Ashapurna Valley",
  "Sangriya",
  "Mogra",
  "Khema Ka Kuan",
  "Idgah",
  "Agolai",
  "Tinwari",
  "Laxmi Nagar",
  "Rajiv Gandhi Colony",
  "Sursagar",
  "Rikhtiya Bheruji",
  "Sivanchi Gate",
  "Chand Pole",
  "Soorsagar Road",
  "Panch Batti Circle",
  "New Power House",
  "Madar",
  "Mahamandir",
];

const POPULAR_AREAS = ["Sardarpura", "Shastri Nagar"];

export default function Home() {
  return (
    <>
      <div
        style={{
          width: "100%",
          background: "#f1f5f9",
          color: "#0f172a",
          textAlign: "center",
          padding: "8px 12px",
          fontWeight: 600,
          fontSize: "14px",
        }}
      >
        🚀 Deployment test – 14 Dec 2025 13:00
      </div>
      <Suspense
        fallback={
          <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-10">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-700 shadow-sm">
              Loading Kaun Karega…
            </div>
          </div>
        }
      >
        <PageContent />
      </Suspense>
    </>
  );
}

function PageContent() {
  const params = useSearchParams();

  const [category, setCategory] = useState(params.get("category") || "");
  const [time, setTime] = useState("");
  const [area, setArea] = useState("");
  const [details, setDetails] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [categoryList, setCategoryList] = useState<string[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showDirectContactOption, setShowDirectContactOption] = useState(false);
  const [providersList, setProvidersList] = useState<any[]>([]);
  const [showProvidersList, setShowProvidersList] = useState(false);
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpError, setOtpError] = useState("");
  const [otpLoading, setOtpLoading] = useState(false);
  const [otpTimer, setOtpTimer] = useState(120); // seconds
  const [canResend, setCanResend] = useState(false);
  const [shakeOtp, setShakeOtp] = useState(false);

  useEffect(() => {
    const fromParams = params.get("category") || "";
    if (fromParams && fromParams !== category) {
      setCategory(fromParams);
    }
  }, [params, category]);

  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch("/api/get-categories");
        if (!res.ok) {
          throw new Error("Failed to fetch categories");
        }
        const data = await res.json();
        const categories = Array.isArray(data?.categories)
          ? data.categories.filter((item: unknown) => typeof item === "string")
          : [];
        setCategoryList(categories);
      } catch (err) {
        console.error("Failed to load categories", err);
        setCategoryList([]);
      }
    };

    fetchCategories();
  }, []);

  useEffect(() => {
    if (!category.trim()) {
      setSuggestions([]);
      return;
    }

    const filtered = categoryList
      .filter((item) =>
        item.toLowerCase().includes(category.trim().toLowerCase())
      )
      .slice(0, 8);
    setSuggestions(filtered);
  }, [category, categoryList]);

  useEffect(() => {
    if (!otpSent) return;
    if (otpTimer === 0) {
      setCanResend(true);
      return;
    }
    const interval = setInterval(() => {
      setOtpTimer((t) => t - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [otpSent, otpTimer]);

  const canSubmit = useMemo(
    () => category.trim() !== "" && time.trim() !== "" && area.trim() !== "",
    [category, time, area]
  );

  const handleSubmit = async () => {
    setError("");
    setSuccess(false);

    if (!canSubmit) {
      setError("Please fill all required fields.");
      return;
    }

    setShowOtpModal(true);
  };

  const submitFinalRequest = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/submit-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          time,
          area,
          details,
          createdAt: new Date().toISOString(),
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to submit request");
      }

      setSuccess(true);
      setShowDirectContactOption(true);
      setDetails("");
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const sendOtp = async () => {
    setOtpError("");
    setOtpLoading(true);
    try {
      const res = await fetch("/api/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to send OTP");
      }
      setOtpSent(true);
    } catch (err: any) {
      setOtpError(err?.message || "Failed to send OTP. Try again.");
    } finally {
      setOtpLoading(false);
    }
  };

  const verifyOtp = async () => {
    setOtpError("");
    setOtpLoading(true);
    try {
      const res = await fetch("/api/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: phone.trim(), otp: otp.trim() }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        setShakeOtp(true);
        setOtpError("Incorrect OTP. Please try again.");
        setTimeout(() => setShakeOtp(false), 600);
        throw new Error(data?.error || "Invalid OTP");
      }
      setShowOtpModal(false);
      await submitFinalRequest();
    } catch (err: any) {
      setOtpError(err?.message || "Invalid OTP. Please try again.");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleShowProviders = async () => {
    try {
      const res = await fetch(
        `/api/find-providers?category=${encodeURIComponent(
          category
        )}&area=${encodeURIComponent(area)}`
      );
      const data = await res.json();
      setProvidersList(Array.isArray(data?.providers) ? data.providers : []);
      setShowProvidersList(true);
    } catch (err) {
      setProvidersList([]);
      setShowProvidersList(false);
    }
  };

  const handleResendOtp = async () => {
    setOtp("");
    setOtpTimer(120);
    setCanResend(false);
    await sendOtp();
  };

  const hasCategory = category.trim() !== "";
  const hasTime = time.trim() !== "";
  const hasArea = area.trim() !== "";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 px-4 py-8">
      <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-lg md:p-8">
        {/* Hero: Logo + Title + Tagline */}
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-4 flex items-center justify-center">
            <Image
              src={logo}
              alt="Kaun Karega logo"
              priority
              className="w-full max-w-[500px] md:max-w-[650px] mx-auto"
            />
          </div>
        </div>

        {/* Step 1: Category search bar */}
        <div className="mb-6">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Step 1 · What help do you need?
          </label>
          <div className="mt-2 flex items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-400/30">
            <span className="mr-2 text-slate-400">🔍</span>
            <input
              type="text"
              value={category}
              onChange={(e) => {
                const value = e.target.value;
                setCategory(value);
                if (!value.trim()) {
                  setSuggestions([]);
                  return;
                }
                const filtered = categoryList
                  .filter((item) =>
                    item.toLowerCase().includes(value.toLowerCase())
                  )
                  .slice(0, 8);
                setSuggestions(filtered);
              }}
              placeholder="Plumber, Electrician, Home Tutor, AC Mechanic..."
              className="w-full bg-transparent text-sm text-slate-900 outline-none md:text-base"
            />
          </div>
          {suggestions.length > 0 && (
            <div className="mt-1 bg-white border border-slate-200 rounded-xl shadow-lg">
              {suggestions.map((item) => (
                <button
                  key={item}
                  className="w-full text-left px-4 py-2 hover:bg-slate-100 text-sm"
                  onClick={() => {
                    setCategory(item);
                    setSuggestions([]);
                  }}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Step 2: When do you need it? */}
        {hasCategory && (
          <div className="mb-6">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Step 2 · When do you need it?
            </label>
            <WhenNeedIt
              selectedTime={time}
              onSelect={(value) => setTime(value)}
            />
          </div>
        )}

        {/* Step 3: Where do you need it? */}
        {hasCategory && hasTime && (
          <div className="mb-6">
            <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
              Step 3 · Where do you need it?
            </label>
            <AreaSelection
              selectedArea={area}
              onSelect={(value) => setArea(value)}
              areas={MASTER_AREAS}
              popularAreas={POPULAR_AREAS}
            />
          </div>
        )}

        {/* Step 4: Task details + Submit */}
        {hasCategory && hasTime && hasArea && (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Step 4 · Task details (optional)
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Describe your work in 1–2 sentences (e.g. &quot;Kitchen tap is leaking, need plumber today evening&quot;)..."
                rows={4}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
              />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}
            {success && (
              <p className="text-sm font-semibold text-emerald-700">
                Your request has been submitted! Nearby providers will contact
                you soon.
              </p>
            )}
            {showDirectContactOption && (
              <div className="mt-4 p-4 bg-slate-50 border rounded-xl">
                <p className="text-sm font-medium text-slate-700">
                  Do you want to contact providers yourself?
                </p>
                <div className="flex gap-3 mt-2">
                  <button
                    className="px-4 py-2 rounded-lg bg-green-600 text-white"
                    onClick={handleShowProviders}
                  >
                    Yes, show numbers
                  </button>
                  <button
                    className="px-4 py-2 rounded-lg bg-slate-200 text-slate-700"
                    onClick={() => setShowProvidersList(false)}
                  >
                    No
                  </button>
                </div>
              </div>
            )}
            {showProvidersList && (
              <div className="mt-4 space-y-3">
                {providersList.map((p) => (
                  <div key={p.phone} className="border rounded-lg p-3">
                    <p className="font-semibold">{p.name}</p>
                    <p className="text-sm text-slate-600">📍 {p.area}</p>
                    <p className="text-sm text-slate-600">📞 {p.phone}</p>
                    <a
                      href={`tel:${p.phone}`}
                      className="mt-2 inline-block px-3 py-1 bg-blue-500 text-white rounded-lg"
                    >
                      Call
                    </a>
                  </div>
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading || !canSubmit}
              className="w-full rounded-full bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-sky-600 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60 md:text-base"
            >
              {loading ? "Submitting your request..." : "Submit Request"}
            </button>
          </div>
        )}

        {/* Small hint at the bottom */}
        <p className="mt-6 text-center text-xs text-slate-400">
          Your phone number will be collected later in a quick step to send you
          updates on WhatsApp.
        </p>
      </div>

      {showOtpModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl space-y-4">
            <div className="space-y-2 text-center">
              <h3 className="text-xl font-semibold text-slate-900">
                Verify your phone number
              </h3>
              <p className="text-sm text-slate-600 mt-2">
                To serve you better, please verify your number.
                <br />
                This helps us connect your request to the right nearby providers.
                <br />
                <br />
                Be assured — your phone number will NOT be shared with any provider.
                <br />
                You will receive a WhatsApp notification where a secure chat box
                <br />
                will appear for your negotiation.
              </p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-700">
                Phone Number
              </label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30"
                placeholder="10-digit mobile number"
                inputMode="numeric"
              />
              <button
                type="button"
                onClick={sendOtp}
                disabled={otpLoading || phone.trim().length !== 10}
                className="w-full rounded-full bg-sky-500 px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-sky-600 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
              >
                {otpLoading ? "Sending OTP..." : "Send OTP"}
              </button>
            </div>

            {otpSent && (
              <div className="space-y-2">
                <label className="text-sm font-semibold text-slate-700">
                  Enter OTP
                </label>
                <input
                  type="tel"
                  value={otp}
                  onChange={(e) => {
                    const value = e.target.value.replace(/\D/g, ""); // allow only digits
                    if (value.length <= 4) setOtp(value);
                    if (value.length === 4) {
                      setTimeout(() => {
                        document.getElementById("verifyOtpBtn")?.focus();
                      }, 50);
                    }
                  }}
                  maxLength={4}
                  inputMode="numeric"
                  pattern="\\d{4}"
                  className={`w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-center text-lg tracking-[0.25em] shadow-sm focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-400/30 ${
                    shakeOtp ? "shake" : ""
                  }`}
                  placeholder="____"
                />
                <button
                  type="button"
                  id="verifyOtpBtn"
                  onClick={verifyOtp}
                  disabled={otpLoading || otp.trim().length !== 4}
                  className="w-full rounded-full bg-emerald-500 px-4 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-emerald-600 hover:shadow-lg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {otpLoading ? "Verifying..." : "Verify OTP"}
                </button>
              </div>
            )}

            {otpSent && (
              <div className="text-center mt-2 text-sm text-slate-600">
                {!canResend ? (
                  <span>
                    Resend OTP in {String(Math.floor(otpTimer / 60)).padStart(2, "0")}:
                    {String(otpTimer % 60).padStart(2, "0")}
                  </span>
                ) : (
                  <button onClick={handleResendOtp} className="text-blue-600 font-medium">
                    Resend OTP
                  </button>
                )}
              </div>
            )}

            {otpError && (
              <p className="text-sm text-red-600 text-center">{otpError}</p>
            )}
            <style jsx>{`
              .shake {
                animation: shake 0.3s linear;
              }
              @keyframes shake {
                0% {
                  transform: translateX(0);
                }
                20% {
                  transform: translateX(-4px);
                }
                40% {
                  transform: translateX(4px);
                }
                60% {
                  transform: translateX(-4px);
                }
                80% {
                  transform: translateX(4px);
                }
                100% {
                  transform: translateX(0);
                }
              }
            `}</style>
          </div>
        </div>
      )}
    </div>
  );
}
