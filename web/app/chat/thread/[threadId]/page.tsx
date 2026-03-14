"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

type PageProps = {
  params: {
    threadId: string;
  };
};

type ProviderProfileResponse = {
  ok?: boolean;
  provider?: {
    ProviderID?: string;
  };
};

type Thread = {
  ThreadID: string;
  TaskID: string;
  UserPhone: string;
  ProviderID: string;
  LastMessage?: string;
  LastMessageAt?: string;
  Status?: string;
};

type ProviderThreadsResponse = {
  ok?: boolean;
  threads?: Thread[];
  error?: string;
};

type ChatMessage = {
  ChatID: string;
  ThreadID: string;
  TaskID: string;
  UserPhone: string;
  ProviderID: string;
  SenderType: string;
  MessageText: string;
  CreatedAt: string;
  ReadByUser: string;
  ReadByProvider: string;
};

type ChatMessagesResponse = {
  ok?: boolean;
  messages?: ChatMessage[];
  error?: string;
};

type SendMessageResponse = {
  ok?: boolean;
  error?: string;
};

export default function ChatThreadPage({ params }: PageProps) {
  const threadId = decodeURIComponent(params.threadId || "").trim();
  const router = useRouter();
  const [providerId, setProviderId] = useState("");
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!threadId) {
      setError("Missing thread ID.");
      setLoading(false);
      return;
    }

    const session = getAuthSession();
    const phone = String(session?.phone || "").replace(/\D/g, "").slice(-10);
    if (!phone) {
      router.replace(`/provider/login?next=${encodeURIComponent(`/chat/thread/${threadId}`)}`);
      return;
    }

    let ignore = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const loadMessages = async (targetThread: Thread, shouldMarkRead = true) => {
      const messageRes = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get_chat_messages",
          ThreadID: targetThread.ThreadID,
        }),
      });
      const messageData = (await messageRes.json()) as ChatMessagesResponse;

      if (!messageRes.ok || !messageData.ok) {
        throw new Error(messageData.error || "Unable to load messages.");
      }

      if (ignore) return;
      setMessages(Array.isArray(messageData.messages) ? messageData.messages : []);

      if (shouldMarkRead) {
        await fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "mark_chat_read",
            ThreadID: targetThread.ThreadID,
            ReaderType: "provider",
          }),
        });
      }
    };

    const loadThread = async (resolvedProviderId: string) => {
      const threadsRes = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get_provider_threads",
          ProviderID: resolvedProviderId,
        }),
      });
      const threadsData = (await threadsRes.json()) as ProviderThreadsResponse;

      if (!threadsRes.ok || !threadsData.ok) {
        throw new Error(threadsData.error || "Unable to load chat thread.");
      }

      const matchedThread = Array.isArray(threadsData.threads)
        ? threadsData.threads.find((item) => String(item.ThreadID || "").trim() === threadId) || null
        : null;

      if (!matchedThread) {
        if (!ignore) setAccessDenied(true);
        return null;
      }

      if (!ignore) {
        setAccessDenied(false);
        setThread(matchedThread);
      }

      return matchedThread;
    };

    const load = async () => {
      setLoading(true);
      setError("");
      setAccessDenied(false);

      try {
        const profileRes = await fetch(
          `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(phone)}`,
          { cache: "no-store" }
        );
        const profileData = (await profileRes.json()) as ProviderProfileResponse;
        const resolvedProviderId = String(profileData.provider?.ProviderID || "").trim();

        if (!profileRes.ok || !profileData.ok || !resolvedProviderId) {
          router.replace(`/provider/login?next=${encodeURIComponent(`/chat/thread/${threadId}`)}`);
          return;
        }

        if (ignore) return;
        setProviderId(resolvedProviderId);
        const matchedThread = await loadThread(resolvedProviderId);
        if (!matchedThread) return;
        await loadMessages(matchedThread, true);

        intervalId = setInterval(() => {
          void (async () => {
            const latestThread = await loadThread(resolvedProviderId);
            if (!latestThread) return;
            await loadMessages(latestThread, true);
          })();
        }, 5000);
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : "Unable to load chat thread.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void load();

    return () => {
      ignore = true;
      if (intervalId) clearInterval(intervalId);
    };
  }, [router, threadId]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const handleSend = async () => {
    if (!thread || !providerId || !input.trim() || sending) return;

    setSending(true);
    setError("");

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_chat_message",
          ThreadID: thread.ThreadID,
          TaskID: thread.TaskID,
          UserPhone: thread.UserPhone,
          ProviderID: providerId,
          SenderType: "provider",
          MessageText: input.trim(),
        }),
      });
      const data = (await res.json()) as SendMessageResponse;

      if (!res.ok || !data.ok) {
        if (data.error === "Chat is closed") {
          setThread((current) => (current ? { ...current, Status: "closed" } : current));
        }
        throw new Error(data.error || "Unable to send message.");
      }

      setInput("");

      const refreshThreadRes = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get_provider_threads",
          ProviderID: providerId,
        }),
      });
      const refreshThreadData = (await refreshThreadRes.json()) as ProviderThreadsResponse;
      if (refreshThreadRes.ok && refreshThreadData.ok && Array.isArray(refreshThreadData.threads)) {
        const refreshedThread =
          refreshThreadData.threads.find((item) => String(item.ThreadID || "").trim() === thread.ThreadID) ||
          null;
        if (refreshedThread) {
          setThread(refreshedThread);
        }
      }

      const refreshMessagesRes = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get_chat_messages",
          ThreadID: thread.ThreadID,
        }),
      });
      const refreshMessagesData = (await refreshMessagesRes.json()) as ChatMessagesResponse;
      if (refreshMessagesRes.ok && refreshMessagesData.ok) {
        setMessages(Array.isArray(refreshMessagesData.messages) ? refreshMessagesData.messages : []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to send message.");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Loading chat...
        </div>
      </main>
    );
  }

  if (accessDenied) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-amber-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-amber-700">
            Access denied. This chat thread does not belong to the logged-in provider.
          </p>
          <Link
            href="/provider/dashboard"
            className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to Provider Dashboard
          </Link>
        </div>
      </main>
    );
  }

  if (error || !thread) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-rose-700">{error || "Chat thread not found."}</p>
          <Link
            href="/provider/dashboard"
            className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to Provider Dashboard
          </Link>
        </div>
      </main>
    );
  }

  const isClosed = String(thread.Status || "").trim().toLowerCase() === "closed";

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Task Chat</h1>
          <p className="mt-1 text-sm text-slate-600">Thread ID: {thread.ThreadID}</p>
          <p className="mt-1 text-sm text-slate-600">Task ID: {thread.TaskID}</p>
          <p className="mt-1 text-sm text-slate-600">Status: {thread.Status || "active"}</p>
          {isClosed ? (
            <p className="mt-2 text-sm font-medium text-amber-700">This chat is closed.</p>
          ) : null}
          {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div ref={scrollRef} className="h-[60vh] space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500">No messages yet.</p>
            ) : (
              messages.map((message) => {
                const isProvider = String(message.SenderType || "").trim().toLowerCase() === "provider";
                return (
                  <div
                    key={message.ChatID}
                    className={`flex ${isProvider ? "justify-end" : "justify-start"}`}
                  >
                    <div className="max-w-[80%] rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {isProvider ? "Provider" : "User"}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                        {message.MessageText}
                      </p>
                      <p className="mt-2 text-[11px] text-slate-500">{message.CreatedAt}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-slate-200 p-4">
            <div className="flex gap-3">
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                disabled={sending || isClosed}
                placeholder={isClosed ? "Chat is closed" : "Type your message"}
                rows={3}
                className="flex-1 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-900 outline-none focus:border-sky-500"
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={sending || isClosed || !input.trim()}
                className="rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {sending ? "Sending..." : "Send"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
