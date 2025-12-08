"use client";

import { useState } from "react";

export default function RegisterPage() {
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submitPhone = async () => {
    if (!phone || phone.length !== 10) {
      setError("Enter a valid 10-digit number");
      return;
    }

    setLoading(true);
    setError("");

  const res = await fetch("/api/register", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ phone }),
});


    const data = await res.json();

    if (data.success) {
      // redirect to verify screen
      window.location.href = `/verify?phone=${phone}`;
    } else {
      setError("Something went wrong. Try again.");
    }

    setLoading(false);
  };

  return (
    <div style={{ padding: 20 }}>
      <h2>Enter your phone number</h2>

      <input
        type="number"
        placeholder="9999999999"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        style={{
          padding: 10,
          width: "100%",
          marginTop: 10,
          border: "1px solid #ccc",
        }}
      />

      <button
        onClick={submitPhone}
        disabled={loading}
        style={{
          marginTop: 20,
          padding: 10,
          width: "100%",
          background: "black",
          color: "white",
          cursor: "pointer",
        }}
      >
        {loading ? "Submitting..." : "Continue"}
      </button>

      {error && (
        <p style={{ marginTop: 10, color: "red" }}>{error}</p>
      )}
    </div>
  );
}
