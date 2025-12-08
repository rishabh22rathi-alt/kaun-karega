"use client";

import { useEffect, useState } from "react";

export default function AdminLoginPage() {
  const [phone, setPhone] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const existingPhone = localStorage.getItem("kk_phone");
    const existingRole = localStorage.getItem("kk_role");
    if (existingPhone && existingRole === "admin") {
      window.location.href = "/admin/dashboard";
    }
  }, []);

  const sendOtp = async () => {
    if (phone.replace(/\D/g, "").length !== 10) {
      setError("Enter a valid 10-digit phone number");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/send-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const data = await res.json();
      if (data.ok) {
        setOtpSent(true);
      } else {
        setError(data.error || "Failed to send OTP");
      }
    } catch (err) {
      setError("Network error. Please try again.");
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
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          otp,
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
        body: JSON.stringify({ phone }),
      });
      const verifyData = await verifyRes.json();
      if (verifyData.ok && verifyData.admin) {
        localStorage.setItem("kk_phone", verifyData.admin.phone);
        localStorage.setItem("kk_role", verifyData.admin.role);
        localStorage.setItem(
          "kk_permissions",
          JSON.stringify(verifyData.admin.permissions || [])
        );
        window.location.href = "/admin/dashboard";
      } else {
        setError("❌ You do not have admin access.");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-6 space-y-4">
        <div className="space-y-1 text-center">
          <h1 className="text-2xl font-bold text-[#0EA5E9]">Admin Login</h1>
          <p className="text-sm text-gray-600">
            Enter your number to receive an OTP.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-gray-700">
            Phone Number
          </label>
          <input
            type="tel"
            value={phone}
            onChange={(e) =>
              setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
            }
            className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
            placeholder="10-digit phone"
          />
        </div>

        {!otpSent ? (
          <button
            type="button"
            onClick={sendOtp}
            disabled={loading}
            className="w-full rounded-full bg-[#0EA5E9] hover:bg-[#0b8ac2] text-white font-semibold py-3 disabled:opacity-60"
          >
            {loading ? "Sending..." : "Send OTP"}
          </button>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700">
                Enter OTP
              </label>
              <input
                type="tel"
                value={otp}
                onChange={(e) =>
                  setOtp(e.target.value.replace(/\D/g, "").slice(0, 4))
                }
                className="w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
                placeholder="4-digit OTP"
              />
            </div>
            <button
              type="button"
              onClick={verifyOtp}
              disabled={loading}
              className="w-full rounded-full bg-green-500 hover:bg-green-600 text-white font-semibold py-3 disabled:opacity-60"
            >
              {loading ? "Verifying..." : "Verify OTP"}
            </button>
          </>
        )}

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
