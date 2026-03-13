"use client";

import { useEffect, useMemo, useState } from "react";

function getPhoneDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 10);
}

function getIndianPhoneForApis(value: string) {
  const digits = getPhoneDigits(value);
  return digits.length === 10 ? `91${digits}` : "";
}

export default function AdminLoginPage() {
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [requestId, setRequestId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const phoneDigits = useMemo(() => getPhoneDigits(phone), [phone]);
  const apiPhone = useMemo(() => getIndianPhoneForApis(phone), [phone]);

  useEffect(() => {
    const existingPhone = localStorage.getItem("kk_phone");
    const existingRole = localStorage.getItem("kk_role");
    if (
      existingPhone &&
      (existingRole === "admin" || existingRole === "superadmin")
    ) {
      window.location.href = "/admin/dashboard";
    }
  }, []);

  const sendOtp = async () => {
    if (phoneDigits.length !== 10 || !apiPhone) {
      setError("Enter a valid 10-digit phone number");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const currentRequestId = requestId || crypto.randomUUID();
      setRequestId(currentRequestId);

      const res = await fetch("/api/send-whatsapp-otp", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phoneNumber: apiPhone,
          requestId: currentRequestId,
        }),
      });

      const rawText = await res.text();

      let data;
      try {
        data = JSON.parse(rawText);
      } catch {
        console.error("Server returned non-JSON:", rawText);
        throw new Error("Server error. Check backend.");
      }

      if (!res.ok) {
        throw new Error(data.error || "Failed to send OTP");
      }

      if (data.ok) {
        setOtpSent(true);
      } else {
        setError(data.error || "Failed to send OTP");
      }
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Network error. Please try again."
      );
    } finally {
      setLoading(false);
    }
  };

  const verifyOtp = async () => {
    if (!otp.trim()) {
      setError("Enter the OTP");
      return;
    }
    if (!/^\d{4}$/.test(otp.trim())) {
      setError("Enter the 4-digit OTP");
      return;
    }
    if (!apiPhone) {
      setError("Enter a valid 10-digit phone number");
      return;
    }
    if (!requestId) {
      setError("Please request a fresh OTP and try again.");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phoneNumber: apiPhone,
          otp,
          requestId,
          name: "Admin",
          role: "admin",
          categories: [],
          areas: [],
        }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Invalid OTP");
        setLoading(false);
        return;
      }

      const verifyRes = await fetch("/api/admin-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: apiPhone }),
      });
      const verifyData = await verifyRes.json();
      if (verifyData.ok && verifyData.admin) {
        localStorage.setItem("kk_phone", verifyData.admin.phone);
        localStorage.setItem("kk_role", verifyData.admin.role);
        localStorage.setItem(
          "kk_permissions",
          JSON.stringify(verifyData.admin.permissions || [])
        );
        if (verifyData.admin.name) {
          localStorage.setItem("kk_name", verifyData.admin.name);
        }
        window.location.href = "/admin/dashboard";
      } else {
        setError("You do not have admin access.");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#0f261d] px-4 py-10 text-slate-100">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(43,111,77,0.38),transparent_34%),linear-gradient(180deg,#143325_0%,#0c1e18_52%,#08130f_100%)]" />
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:36px_36px]" />

      <div className="relative w-full max-w-md rounded-[28px] border border-white/10 bg-white/96 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.35)] backdrop-blur">
        <div className="mb-6 space-y-4">
          <div className="inline-flex items-center gap-3 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#123524] text-sm font-black uppercase tracking-[0.18em] text-white">
              KK
            </span>
            <div className="text-left">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700">
                Kaun Karega
              </p>
              <p className="text-xs text-slate-600">Admin Workspace</p>
            </div>
          </div>

          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-slate-900">Admin Login</h1>
            <p className="text-sm text-slate-600">
              Sign in with your admin number to receive a one-time code.
            </p>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-slate-800">
            Phone Number
          </label>
          <input
            type="tel"
            inputMode="numeric"
            autoComplete="tel"
            value={phone}
            onChange={(e) => {
              setPhone(getPhoneDigits(e.target.value));
              if (error) setError("");
            }}
            className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
            placeholder="Enter 10-digit phone number"
          />
          <p className="text-xs text-slate-500">
            Use the same number configured in the Admins sheet.
          </p>
        </div>

        {!otpSent ? (
          <button
            type="button"
            onClick={sendOtp}
            disabled={loading}
            className="mt-5 w-full rounded-full bg-[#143b2a] py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-[#102f21] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send OTP"}
          </button>
        ) : (
          <>
            <div className="mt-5 space-y-2">
              <label className="text-sm font-semibold text-slate-800">
                Enter OTP
              </label>
              <input
                type="tel"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={otp}
                onChange={(e) => {
                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 4));
                  if (error) setError("");
                }}
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium tracking-[0.35em] text-slate-900 shadow-sm outline-none transition placeholder:tracking-normal placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-200"
                placeholder="4-digit OTP"
              />
            </div>
            <button
              type="button"
              onClick={verifyOtp}
              disabled={loading}
              className="mt-5 w-full rounded-full bg-emerald-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Verifying..." : "Verify OTP"}
            </button>
          </>
        )}

        {error && (
          <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
