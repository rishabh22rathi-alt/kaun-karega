"use client";

import { useEffect, useRef, useState, KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { setAuthSession } from "@/lib/auth";
import { SIDEBAR_TOGGLE_EVENT } from "@/components/sidebarEvents";

const DEFAULT_NEXT = "/";

const getSafeNext = (value: string | null): string => {
  if (!value) return DEFAULT_NEXT;
  if (!value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_NEXT;
  }
  return value;
};

export default function VerifyPage() {
  const router = useRouter();
  const [otp, setOtp] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [requestId, setRequestId] = useState("");
  const [nextPath, setNextPath] = useState(DEFAULT_NEXT);
  const [cooldown, setCooldown] = useState(0);

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // ---------------------------------------------------
  // LOAD PHONE FROM URL + AUTO SEND OTP WHEN PAGE OPENS
  // ---------------------------------------------------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get("phone");
    const r = params.get("requestId");
    const next = params.get("next");

    if (p) {
      setPhone(p);
      if (r) setRequestId(r);
      setNextPath(getSafeNext(next));
      sendOtpImmediately(p, r ?? undefined);
    }
  }, []);

  const sendOtpImmediately = async (
    phoneOverride?: string,
    requestIdOverride?: string
  ) => {
    setCooldown(0);
    await sendOtp(phoneOverride, requestIdOverride);
  };

  // ---------------------------------------------------
  // COOLDOWN TIMER
  // ---------------------------------------------------
  useEffect(() => {
    if (cooldown <= 0) return;

    const timer = setInterval(() => {
      setCooldown((prev) => (prev <= 1 ? 0 : prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [cooldown]);

  // ---------------------------------------------------
  // SEND OTP FUNCTION
  // ---------------------------------------------------
  const sendOtp = async (
    phoneOverride?: string,
    requestIdOverride?: string
  ) => {
    const activePhone = phoneOverride ?? phone;
    if (!activePhone) return;
    if (cooldown > 0) return;

    const normalizedPhone = activePhone.replace(/\D/g, "");
    if (
      normalizedPhone.length !== 10 &&
      !(normalizedPhone.length === 12 && normalizedPhone.startsWith("91"))
    ) {
      setError("Enter a valid 10-digit Indian mobile number");
      return;
    }

    const normalized =
      normalizedPhone.length === 10
        ? `91${normalizedPhone}`
        : normalizedPhone;
    const currentRequestId =
      requestIdOverride || requestId || crypto.randomUUID();
    setRequestId(currentRequestId);

    setSendingOtp(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/send-whatsapp-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: normalized,
          requestId: currentRequestId,
        }),
      });

      const data = await res.json();
      console.log("SEND OTP RESPONSE:", data);

      if (data.ok) {
        setMessage("OTP sent successfully on WhatsApp!");
        setCooldown(60);
      } else {
        setError(data?.error || "Failed to send OTP");
      }
    } catch (err) {
      setError("Network Error");
    }

    setSendingOtp(false);
  };

  const handleResendOtp = async () => {
    const freshRequestId = crypto.randomUUID();
    setRequestId(freshRequestId);
    setOtp("");
    setError("");
    await sendOtp(phone, freshRequestId);
  };

  // ---------------------------------------------------
  // VERIFY OTP FUNCTION
  // ---------------------------------------------------
  const verifyOtp = async () => {
    if (!/^\d{4}$/.test(otp)) {
      setError("Enter 4-digit OTP");
      return;
    }

    const normalizedPhone = phone.replace(/\D/g, "");
    if (
      normalizedPhone.length !== 10 &&
      !(normalizedPhone.length === 12 && normalizedPhone.startsWith("91"))
    ) {
      setError("Enter a valid 10-digit Indian mobile number");
      return;
    }

    const normalized =
      normalizedPhone.length === 10
        ? `91${normalizedPhone}`
        : normalizedPhone;

    setVerifyingOtp(true);
    setError("");

    try {
      const res = await fetch("/api/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: normalized,
          otp,
          requestId,
        }),
      });

      const data = await res.json();

      if (data.ok) {
        const displayPhone = normalized.slice(-10);
        setAuthSession(displayPhone);
        // Mirror admin status from server response — sidebar reads this
        if (data.isAdmin === true) {
          window.localStorage.setItem(
            "kk_admin_session",
            JSON.stringify({
              isAdmin: true,
              name: data.adminName ?? null,
              role: data.adminRole ?? null,
              permissions: data.permissions ?? [],
            })
          );
        } else {
          window.localStorage.removeItem("kk_admin_session");
        }
        window.dispatchEvent(
          new CustomEvent(SIDEBAR_TOGGLE_EVENT, {
            detail: { type: "auth-updated" },
          })
        );
        router.replace(nextPath);
      } else {
        setError(data?.error || "Verification failed");
      }
    } catch (err) {
      setError("Network Error");
    }

    setVerifyingOtp(false);
  };

  // ---------------------------------------------------
  // OTP BOX HANDLERS
  // ---------------------------------------------------
  const handleDigitInput = (index: number, value: string) => {
    const digit = value.replace(/\D/g, "").slice(-1);
    const newOtp = otp.split("");
    newOtp[index] = digit;
    const filled = Array.from({ length: 4 }, (_, i) => newOtp[i] ?? "");
    setOtp(filled.join(""));

    if (digit && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleDigitKeyDown = (
    index: number,
    e: KeyboardEvent<HTMLInputElement>
  ) => {
    if (e.key === "Backspace") {
      if (otp[index]) {
        const chars = otp.split("");
        chars[index] = "";
        setOtp(Array.from({ length: 4 }, (_, i) => chars[i] ?? "").join(""));
      } else if (index > 0) {
        inputRefs.current[index - 1]?.focus();
      }
    }
  };

  // ---------------------------------------------------
  // UI
  // ---------------------------------------------------
  return (
    <main className="min-h-screen bg-amber-50 flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-lg p-8 space-y-6">

        {/* Heading */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-slate-900">Verify your number</h1>
          {phone && (
            <p className="text-sm text-slate-500">
              Code sent to{" "}
              <span className="font-semibold text-slate-700">
                +91 {phone.replace(/\D/g, "").slice(-10)}
              </span>
            </p>
          )}
        </div>

        {/* Messages */}
        {message && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {message}
          </div>
        )}
        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* 4 OTP Boxes */}
        <div className="flex justify-center gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <input
              key={i}
              ref={(el) => { inputRefs.current[i] = el; }}
              type="text"
              inputMode="numeric"
              maxLength={1}
              value={otp[i] ?? ""}
              onChange={(e) => handleDigitInput(i, e.target.value)}
              onKeyDown={(e) => handleDigitKeyDown(i, e)}
              className="w-14 h-14 rounded-xl border-2 border-slate-200 bg-white text-center text-2xl font-bold text-slate-900 shadow-sm transition focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/30"
            />
          ))}
        </div>

        {/* Verify Button */}
        <button
          onClick={verifyOtp}
          disabled={verifyingOtp}
          className="w-full rounded-xl bg-green-600 px-4 py-3 text-white font-semibold shadow-md transition hover:bg-green-700 active:scale-95 disabled:opacity-60"
        >
          {verifyingOtp ? "Verifying..." : "Verify & Continue"}
        </button>

        {/* Resend */}
        <div className="text-center text-sm">
          {cooldown > 0 ? (
            <p className="text-slate-400">
              Resend OTP in{" "}
              <span className="font-semibold text-slate-600">{cooldown}s</span>
            </p>
          ) : (
            <button
              onClick={() => {
                void handleResendOtp();
              }}
              disabled={sendingOtp}
              className="font-semibold text-green-600 hover:text-green-700 transition"
            >
              {sendingOtp ? "Sending OTP..." : "Resend OTP"}
            </button>
          )}
        </div>

      </div>
    </main>
  );
}
