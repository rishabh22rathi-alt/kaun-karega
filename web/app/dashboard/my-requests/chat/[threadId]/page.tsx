"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { getTaskDisplayLabel } from "@/lib/taskDisplay";

type PageProps = {
  params: {
    threadId: string;
  };
};

type Thread = {
  ThreadID: string;
  TaskID: string;
  DisplayID?: string;
  UserPhone: string;
  ProviderID: string;
  LastMessageAt?: string;
  Status?: string;
};

type ChatMessage = {
  MessageID: string;
  ThreadID: string;
  TaskID: string;
  SenderType: string;
  MessageText: string;
  CreatedAt: string;
  ReadByUser?: string;
  ReadByProvider?: string;
};

type ChatMessagesResponse = {
  ok?: boolean;
  thread?: Thread;
  messages?: ChatMessage[];
  error?: string;
};

type SendMessageResponse = {
  ok?: boolean;
  error?: string;
};

export default function UserRequestChatPage({ params }: PageProps) {
  const threadId = decodeURIComponent(params.threadId || "").trim();
  const router = useRouter();
  const [userPhone, setUserPhone] = useState("");
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
    const normalizedPhone = String(session?.phone || "").replace(/\D/g, "").slice(-10);
    if (!normalizedPhone) {
      router.replace(`/login?next=${encodeURIComponent(`/dashboard/my-requests/chat/${threadId}`)}`);
      return;
    }

    let ignore = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const loadMessages = async (phone: string, shouldMarkRead = true) => {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_get_messages",
          ActorType: "user",
          ThreadID: threadId,
          UserPhone: phone,
        }),
      });
      const data = (await res.json()) as ChatMessagesResponse;

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Unable to load messages.");
      }

      if (ignore) return;
      setThread(data.thread || null);
      setMessages(Array.isArray(data.messages) ? data.messages : []);

      if (shouldMarkRead) {
        await fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "chat_mark_read",
            ActorType: "user",
            ThreadID: threadId,
            UserPhone: phone,
          }),
        });
      }
    };

    const load = async () => {
      setLoading(true);
      setError("");
      setAccessDenied(false);

      try {
        if (ignore) return;
        setUserPhone(normalizedPhone);
        await loadMessages(normalizedPhone, true);

        intervalId = setInterval(() => {
          void loadMessages(normalizedPhone, true).catch(() => undefined);
        }, 5000);
      } catch (err) {
        if (ignore) return;
        const message = err instanceof Error ? err.message : "Unable to load chat.";
        if (message.toLowerCase().includes("access denied")) {
          setAccessDenied(true);
          setError("");
        } else {
          setError(message);
        }
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
    if (!thread || !userPhone || !input.trim() || sending) return;

    setSending(true);
    setError("");

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_send_message",
          ActorType: "user",
          ThreadID: thread.ThreadID,
          UserPhone: userPhone,
          MessageText: input.trim(),
        }),
      });
      const data = (await res.json()) as SendMessageResponse;

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Unable to send message.");
      }

      setInput("");

      const refreshRes = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_get_messages",
          ActorType: "user",
          ThreadID: thread.ThreadID,
          UserPhone: userPhone,
        }),
      });
      const refreshData = (await refreshRes.json()) as ChatMessagesResponse;
      if (refreshRes.ok && refreshData.ok) {
        setThread(refreshData.thread || thread);
        setMessages(Array.isArray(refreshData.messages) ? refreshData.messages : []);
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
            Access denied. This chat thread does not belong to this user.
          </p>
          <Link
            href="/dashboard/my-requests"
            className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to My Requests
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
            href="/dashboard/my-requests"
            className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to My Requests
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
          <h1 className="text-xl font-semibold text-slate-900">Request Chat</h1>
          <p className="mt-1 text-sm text-slate-600">Thread ID: {thread.ThreadID}</p>
          <p className="mt-1 text-sm text-slate-600">
            {getTaskDisplayLabel(thread, thread.TaskID)}
          </p>
          <p className="mt-1 text-sm text-slate-600">Provider ID: {thread.ProviderID}</p>
          <p className="mt-1 text-sm text-slate-600">Status: {thread.Status || "active"}</p>
          {isClosed ? <p className="mt-2 text-sm font-medium text-amber-700">This chat is closed.</p> : null}
          {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div ref={scrollRef} className="h-[60vh] space-y-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <p className="text-sm text-slate-500">No messages yet.</p>
            ) : (
              messages.map((message) => {
                const isUser = String(message.SenderType || "").trim().toLowerCase() === "user";
                return (
                  <div
                    key={message.MessageID}
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div className="max-w-[80%] rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        {isUser ? "User" : "Provider"}
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
