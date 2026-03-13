"use client";
import { useState } from "react";

export default function RegisterPage() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submitPhone = async () => {
    if (loading) return;

    const normalized = phone.replace(/\D/g, "");
    if (!normalized || normalized.length !== 10) {
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
      } catch {
        console.error("OTP API non-JSON response", { status: res.status });
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
        // redirect to verify screen
        window.location.href = `/verify?phone=${normalized}&requestId=${encodeURIComponent(
          requestId
        )}`;
      } else {
        setError(data?.message || "Something went wrong. Try again.");
      }
    } catch (err) {
      console.error("OTP request crashed", err);
      const message =
        err instanceof Error ? err.message : "Something went wrong. Try again.";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded shadow-md w-96">
        <h2 className="text-2xl mb-4 font-bold text-center text-black">
          Enter your phone number
        </h2>

        <input
          type="tel"
          inputMode="numeric"
          maxLength={10}
          placeholder="9999999999"
          value={phone}
          onChange={(e) => {
            setPhone(e.target.value.replace(/\D/g, "").slice(0, 10));
            if (error) setError("");
          }}
          className="border p-2 w-full rounded mb-4 text-black font-semibold placeholder:text-gray-400"
        />

        {error && (
          <p className="text-sm text-red-600 mb-4">{error}</p>
        )}

        <button
          onClick={submitPhone}
          disabled={loading}
          className="bg-black text-white w-full py-2 rounded hover:bg-gray-800 disabled:opacity-60"
        >
          {loading ? "Submitting..." : "Continue"}
        </button>
      </div>
    </div>
  );
}
