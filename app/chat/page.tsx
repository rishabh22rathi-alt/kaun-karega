"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function ChatEntryPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskId = searchParams.get("taskId") || "";
  const provider = searchParams.get("provider") || "";
  const [error, setError] = useState("");

  useEffect(() => {
    if (!taskId || !provider) {
      setError("Missing task details.");
      return;
    }

    if (typeof window === "undefined") return;
    const phone =
      localStorage.getItem("kk_user_phone") || localStorage.getItem("kk_phone") || "";

    if (!phone) {
      const redirect = `/login?redirectTo=${encodeURIComponent(
        `/chat?taskId=${taskId}&provider=${provider}`
      )}`;
      router.replace(redirect);
      return;
    }

    const openChat = async () => {
      try {
        const res = await fetch("/api/chat/open", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, provider }),
        });
        const data = await res.json();
        if (!res.ok || !data.roomId) {
          setError(data.error || "Unable to open chat.");
          return;
        }
        router.replace(`/chat/${data.roomId}`);
      } catch (err) {
        setError("Network error. Please try again.");
      }
    };

    openChat();
  }, [provider, router, taskId]);

  return (
    <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-8">
      <div className="rounded-xl bg-white shadow-lg px-6 py-4 text-sm text-slate-700">
        {error ? error : "Opening chat..."}
      </div>
    </main>
  );
}
