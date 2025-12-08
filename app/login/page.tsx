"use client";
"use client";
import { useState } from "react";

export default function LoginPage() {
  const [phone, setPhone] = useState("");

  async function handleLogin(e: any) {
    e.preventDefault();

    if (phone.length !== 10) {
      alert("Please enter a valid 10-digit phone number");
      return;
    }

    try {
      // 1️⃣ CHECK IF USER EXISTS IN SHEETS
      const res = await fetch(
        "https://script.google.com/macros/s/AKfycbwUbKw6vXMON4aFOYPCFrPWXbDno-4BN3M086QkbwGNPLzB7mh7G4htdERcWQqIKX5wmA/exec",
        {
          method: "POST",
          body: JSON.stringify({ phone }),
        }
      );

      const data = await res.json();

      if (!data.exists) {
        alert("⚠️ Number not found. Please register first.");
        window.location.href = "/register";
        return;
      }

      // 2️⃣ USER EXISTS → REDIRECT TO VERIFY PAGE WITH PHONE
      window.location.href = `/verify?phone=${phone}`;

    } catch (error) {
      alert("Something went wrong. Try again.");
      console.log(error);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100">
      <form
        onSubmit={handleLogin}
        className="bg-white p-8 rounded shadow-md w-96"
      >
        <h2 className="text-2xl mb-4 font-bold text-center">Login</h2>

        <input
          type="text"
          placeholder="Enter WhatsApp Number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="border p-2 w-full rounded mb-4"
        />

        <button
          type="submit"
          className="bg-black text-white w-full py-2 rounded hover:bg-gray-800"
        >
          Continue
        </button>
      </form>
    </div>
  );
}
