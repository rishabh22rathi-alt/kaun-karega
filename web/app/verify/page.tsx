"use client";

"use client";
import { useEffect, useState } from "react";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [requestId, setRequestId] = useState("");
  const [nextPath, setNextPath] = useState(DEFAULT_NEXT);
  const [cooldown, setCooldown] = useState(0);

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
    if (requestIdOverride || !requestId) setRequestId(currentRequestId);

    setLoading(true);
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

    setLoading(false);
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
    if (normalizedPhone.length !== 10 && !(normalizedPhone.length === 12 && normalizedPhone.startsWith("91"))) {
      setError("Enter a valid 10-digit Indian mobile number");
      return;
    }

    const normalized =
      normalizedPhone.length === 10
        ? `91${normalizedPhone}`
        : normalizedPhone;

    setLoading(true);
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

    setLoading(false);
  };

  // ---------------------------------------------------
  // UI
  // ---------------------------------------------------
  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-md">
        <h2>Verify OTP for {phone}</h2>

      <button
        onClick={() => {
          void sendOtp();
        }}
        disabled={cooldown > 0}
        style={{
          marginTop: 10,
          padding: 10,
          width: "100%",
          background: cooldown > 0 ? "#777" : "black",
          color: "white",
          fontWeight: "bold",
          cursor: cooldown > 0 ? "not-allowed" : "pointer",
          borderRadius: 5,
        }}
      >
        {cooldown > 0
          ? `Send OTP Again in ${cooldown}s`
          : "Send OTP Again"}
      </button>

      {message && <p style={{ color: "lightgreen" }}>{message}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder="Enter 4-digit OTP"
          value={otp}
          onChange={(e) =>
            setOtp(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))
          }
          className="mt-5 w-full rounded border border-gray-300 bg-white p-2 text-xl font-bold tracking-widest text-black caret-black placeholder:text-gray-400"
        />

        <button
          onClick={verifyOtp}
          style={{
            marginTop: 20,
            padding: 10,
            width: "100%",
            background: "green",
            color: "white",
            fontWeight: "bold",
            borderRadius: 5,
            cursor: "pointer",
          }}
        >
          {loading ? "Verifying..." : "Verify OTP"}
        </button>
      </div>
    </main>
  );
}
