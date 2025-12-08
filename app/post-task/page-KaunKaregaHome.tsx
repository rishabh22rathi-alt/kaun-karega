"use client";

import { useState } from "react";

export default function PostTaskPage() {
  const [category, setCategory] = useState("");
  const [details, setDetails] = useState("");
  const [area, setArea] = useState("");
  const [urgency, setUrgency] = useState("Today");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!category || !details || !area || !urgency || !phone) {
      setError("Please fill all required fields.");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/tasks/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category,
          details,
          area,
          urgency,
          phone,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setMessage("Task posted successfully!");
        setCategory("");
        setDetails("");
        setArea("");
        setUrgency("Today");
        setPhone("");
      } else {
        setError(data.message || "Failed to post task");
      }
    } catch (err) {
      setError("Network error");
    }

    setLoading(false);
  };

  return (
    <div style={{ padding: 20, maxWidth: 500, margin: "auto" }}>
      <h2>Post a Task</h2>

      {message && <p style={{ color: "green" }}>{message}</p>}
      {error && <p style={{ color: "red" }}>{error}</p>}

      <input
        type="text"
        placeholder="Category (Required)"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        style={{
          padding: 10,
          width: "100%",
          marginTop: 10,
          border: "1px solid #ccc",
          borderRadius: 5,
        }}
      />

      <textarea
        placeholder="Task Details (Required)"
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        rows={4}
        style={{
          padding: 10,
          width: "100%",
          marginTop: 10,
          border: "1px solid #ccc",
          borderRadius: 5,
        }}
      />

      <input
        type="text"
        placeholder="Area (Required)"
        value={area}
        onChange={(e) => setArea(e.target.value)}
        style={{
          padding: 10,
          width: "100%",
          marginTop: 10,
          border: "1px solid #ccc",
          borderRadius: 5,
        }}
      />

      <select
        value={urgency}
        onChange={(e) => setUrgency(e.target.value)}
        style={{
          padding: 10,
          width: "100%",
          marginTop: 10,
          border: "1px solid #ccc",
          borderRadius: 5,
          background: "white",
        }}
      >
        <option value="" disabled>
          Select urgency
        </option>
        <option value="Immediate">Immediate</option>
        <option value="Today">Today</option>
        <option value="This Week">This Week</option>
      </select>

      <input
        type="number"
        placeholder="Your Phone Number (Required)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        style={{
          padding: 10,
          width: "100%",
          marginTop: 10,
          border: "1px solid #ccc",
          borderRadius: 5,
        }}
      />

      <button
        onClick={handleSubmit}
        style={{
          marginTop: 20,
          padding: 10,
          width: "100%",
          background: "black",
          color: "white",
          fontWeight: "bold",
          borderRadius: 5,
          cursor: "pointer",
        }}
      >
        {loading ? "Posting..." : "Post Task"}
      </button>
    </div>
  );
}
