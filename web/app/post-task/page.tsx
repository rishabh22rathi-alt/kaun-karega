"use client";

"use client";
import { useState } from "react";

export default function PostTaskPage() {
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [location, setLocation] = useState("");
  const [budget, setBudget] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!taskTitle || !taskDescription || !location || !phone) {
      setError("Please fill all required fields");
      return;
    }

    setLoading(true);
    setError("");
    setMessage("");

    try {
      const res = await fetch("/api/save-task", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone,
          taskTitle,
          taskDescription,
          location,
          budget,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setMessage("Task posted successfully!");
        setTaskTitle("");
        setTaskDescription("");
        setLocation("");
        setBudget("");
        setPhone("");
      } else {
        setError("Failed to post task");
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
        placeholder="Task Title (Required)"
        value={taskTitle}
        onChange={(e) => setTaskTitle(e.target.value)}
        style={{
          padding: 10,
          width: "100%",
          marginTop: 10,
          border: "1px solid #ccc",
          borderRadius: 5,
        }}
      />

      <textarea
        placeholder="Task Description (Required)"
        value={taskDescription}
        onChange={(e) => setTaskDescription(e.target.value)}
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
        placeholder="Location (Required)"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
        style={{
          padding: 10,
          width: "100%",
          marginTop: 10,
          border: "1px solid #ccc",
          borderRadius: 5,
        }}
      />

      <input
        type="number"
        placeholder="Budget (Optional)"
        value={budget}
        onChange={(e) => setBudget(e.target.value)}
        style={{
          padding: 10,
          width: "100%",
          marginTop: 10,
          border: "1px solid #ccc",
          borderRadius: 5,
        }}
      />

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
