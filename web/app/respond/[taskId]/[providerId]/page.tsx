"use client";

"use client";
import { useEffect, useState } from "react";

type PageProps = {
  params: { taskId: string; providerId: string };
};

export default function RespondPage({ params }: PageProps) {
  const { taskId, providerId } = params;
  const [message, setMessage] = useState(
    "Recording your response. Please wait..."
  );
  const [error, setError] = useState("");

  useEffect(() => {
    const recordResponse = async () => {
      try {
        const res = await fetch(
          `/api/tasks/respond?taskId=${encodeURIComponent(
            taskId
          )}&providerId=${encodeURIComponent(providerId)}`,
          { cache: "no-store" }
        );
        const data = await res.json();
        if (!data.success) {
          throw new Error(data.message || "Unable to record response");
        }
        setMessage("Thanks, your response is recorded.");
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Something went wrong. Please try again.";
        setError(msg);
      }
    };

    recordResponse();
  }, [providerId, taskId]);

  return (
    <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-6 space-y-4 text-center">
        <header className="space-y-1">
          <p className="text-xs font-semibold text-[#0EA5E9] uppercase">
            Kaun Karega
          </p>
          <h1 className="text-2xl font-bold text-[#111827]">Job Response</h1>
        </header>

        {!error && (
          <p className="text-sm text-[#111827]">{message}</p>
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
