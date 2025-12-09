"use client";

"use client";
import { useEffect, useState } from "react";

export default function VerifyPage() {
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [phone, setPhone] = useState("");
  const [cooldown, setCooldown] = useState(0);

  // ---------------------------------------------------
  // LOAD PHONE FROM URL + AUTO SEND OTP WHEN PAGE OPENS
  // ---------------------------------------------------
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const p = params.get("phone");

    if (p) {
      setPhone(p);
      sendOtpImmediately();
    }
  }, []);

  const sendOtpImmediately = async () => {
    setCooldown(0);
    await sendOtp();
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
  const sendOtp = async () => {
    if (!phone) return;
    if (cooldown > 0) return;

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/send-whatsapp-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });

      const data = await res.json();
      console.log("SEND OTP RESPONSE:", data);

      if (data.success) {
        setMessage("OTP sent successfully on WhatsApp!");
        setCooldown(60);
      } else {
        setError("Failed to send OTP");
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
    if (otp.length !== 6) {
      setError("Enter 6-digit OTP");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, otp }),
      });

      const data = await res.json();

      if (data.success) {
        window.location.href = "/";
      } else {
        if (data.message === "OTP Expired") {
          setError("OTP expired. Please request a new OTP.");
        } else if (data.message === "Incorrect OTP") {
          setError("Incorrect OTP. Try again.");
        } else {
          setError("Verification failed");
        }
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
    <div style={{ padding: 20 }}>
      <h2>Verify OTP for {phone}</h2>

      <button
        onClick={sendOtp}
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
        type="number"
        placeholder="Enter 6-digit OTP"
        value={otp}
        onChange={(e) => setOtp(e.target.value)}
        style={{
          padding: 10,
          width: "100%",
          marginTop: 20,
          border: "1px solid #ccc",
          borderRadius: 5,
          fontSize: 16,
        }}
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
  );
}
