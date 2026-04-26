"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

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

export default function ChatEntryPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-8">
          <div className="rounded-xl bg-white shadow-lg px-6 py-4 text-sm text-slate-700">
            Opening chat...
          </div>
        </main>
      }
    >
      <PageContent />
    </Suspense>
  );
}

function PageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const taskId = searchParams.get("taskId") || "";
  const provider = searchParams.get("provider") || "";
  const [error, setError] = useState("");

  useEffect(() => {
    if (!taskId || !provider) {
      router.replace("/dashboard/my-requests");
      return;
    }

    const session = getAuthSession();
    const phone = String(session?.phone || "").replace(/\D/g, "").slice(-10);

    if (!phone) {
      router.replace(
        `/login?next=${encodeURIComponent(`/chat?taskId=${taskId}&provider=${provider}`)}`
      );
      return;
    }

    const openChat = async () => {
      try {
        const res = await fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "chat_create_or_get_thread",
            ActorType: "user",
            UserPhone: phone,
            TaskID: taskId,
            ProviderID: provider,
          }),
        });
        const data = (await res.json()) as CreateThreadResponse;
        const threadId = extractThreadId(data);

        if (!res.ok || !data?.ok || !threadId) {
          setError(data?.error || data?.message || "Unable to open chat.");
          return;
        }

        router.replace(`/chat/thread/${encodeURIComponent(threadId)}?actor=user`);
      } catch {
        setError("Network error. Please try again.");
      }
    };

    void openChat();
  }, [provider, router, taskId]);

  return (
    <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-8">
      <div className="rounded-xl bg-white shadow-lg px-6 py-4 text-sm text-slate-700">
        {error ? (
          <div>
            <p className="mb-3">{error}</p>
            <a href="/dashboard/my-requests" className="text-sky-700 underline">
              Back to Responses
            </a>
          </div>
        ) : (
          "Opening chat..."
        )}
      </div>
    </main>
  );
}
