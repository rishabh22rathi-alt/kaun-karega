"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

type PageProps = {
  params: Promise<{ taskId: string; providerId: string }>;
};

type CreateThreadResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  ThreadID?: string;
  threadId?: string;
  thread?: {
    ThreadID?: string;
    threadId?: string;
  };
};

function extractThreadId(data: CreateThreadResponse): string {
  return String(
    data?.thread?.ThreadID ||
      data?.thread?.threadId ||
      data?.ThreadID ||
      data?.threadId ||
      ""
  ).trim();
}

export default function RespondPage({ params }: PageProps) {
  const { taskId, providerId } = use(params);
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    if (!taskId || !providerId) {
      setError("Missing task or provider reference.");
      return;
    }

    const session = getAuthSession();
    const phone = String(session?.phone || "").replace(/\D/g, "").slice(-10);
    if (phone.length !== 10) {
      router.replace(
        `/provider/login?next=${encodeURIComponent(
          `/respond/${encodeURIComponent(taskId)}/${encodeURIComponent(providerId)}`
        )}`
      );
      return;
    }

    let cancelled = false;

    const run = async () => {
      // 1. Record the response. Same backend the in-app "Open Chat" button
      //    already calls (provider/my-jobs, provider/job-requests). It is
      //    idempotent: re-runs flip match_status to 'responded' without
      //    side effects. Soft-fail — a transient blip here must not block
      //    the provider from reaching the chat.
      try {
        await fetch("/api/tasks/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, providerId }),
        });
      } catch {
        // Continue to chat regardless.
      }

      // 2. Create or fetch the chat thread for the LOGGED-IN provider.
      //    URL providerId is intentionally not forwarded — the chat action
      //    resolves the provider from the session phone and rejects the
      //    request if that provider isn't matched to this task.
      try {
        const res = await fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "chat_create_or_get_thread",
            ActorType: "provider",
            TaskID: taskId,
            loggedInProviderPhone: phone,
          }),
        });
        const data = (await res.json()) as CreateThreadResponse;
        const threadId = extractThreadId(data);

        if (cancelled) return;
        if (!res.ok || !data?.ok || !threadId) {
          setError(data?.error || data?.message || "Unable to open chat.");
          return;
        }

        router.replace(`/chat/thread/${encodeURIComponent(threadId)}`);
      } catch {
        if (!cancelled) setError("Network error. Please try again.");
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [taskId, providerId, router]);

  return (
    <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg p-6 space-y-3 text-center">
        <header className="space-y-1">
          <p className="text-xs font-semibold text-[#0EA5E9] uppercase">
            Kaun Karega
          </p>
          <h1 className="text-2xl font-bold text-[#111827]">Job Response</h1>
        </header>

        {!error ? (
          <p className="text-sm text-[#111827]">Opening chat...</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
              {error}
            </p>
            <a
              href="/provider/my-jobs"
              className="inline-block text-sm font-semibold text-sky-700 underline"
            >
              Back to my jobs
            </a>
          </div>
        )}
      </div>
    </main>
  );
}
