"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { getTaskDisplayLabel } from "@/lib/taskDisplay";

type ProviderProfileResponse = {
  ok?: boolean;
  provider?: {
    Phone?: string;
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
  ReadByUser: string;
  ReadByProvider: string;
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

const PROVIDER_QUICK_REPLIES = [
  "Please share exact location.",
  "What time do you need this?",
  "I can come today.",
  "Call me to discuss.",
];

const USER_QUICK_REPLIES = [
  "What will be the charges?",
  "Can you come today?",
  "Please call me.",
  "I will share location.",
  "When are you available?",
];

function formatMessageTimestamp(value: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const timeLabel = date.toLocaleTimeString("en-IN", {
    hour: "numeric",
    minute: "2-digit",
  });

  if (sameDay) return `Today, ${timeLabel}`;

  return `${date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
  })}, ${timeLabel}`;
}

function formatHeaderTimestamp(value?: string): string {
  if (!value) return "No activity yet";
  return formatMessageTimestamp(value);
}

function getCounterpartyLabel(actorType: "user" | "provider"): string {
  return actorType === "provider" ? "User" : "Provider";
}

function buildSharePhoneReply(phone: string): string {
  return `You can call me at ${phone}`;
}

export default function ChatThreadPage() {
  const params = useParams<{ threadId?: string | string[] }>();
  const routeThreadId = Array.isArray(params?.threadId) ? params.threadId[0] : params?.threadId;
  const threadId = decodeURIComponent(String(routeThreadId || "")).trim();
  const router = useRouter();
  const searchParams = useSearchParams();
  const actorType = searchParams.get("actor") === "user" ? "user" : "provider";
  const [actorPhone, setActorPhone] = useState("");
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const backHref = actorType === "user" ? "/dashboard/my-requests" : "/provider/dashboard";
  const nextPath = actorType === "user" ? `/chat/thread/${threadId}?actor=user` : `/chat/thread/${threadId}`;
  const loginHref = actorType === "user" ? "/login" : "/provider/login";
  const trimmedInput = input.trim();
  const quickReplies = actorType === "provider" ? PROVIDER_QUICK_REPLIES : USER_QUICK_REPLIES;

  useEffect(() => {
    if (!threadId) {
      setError("Missing thread ID.");
      setLoading(false);
      return;
    }

    const session = getAuthSession();
    const phone = String(session?.phone || "").replace(/\D/g, "").slice(-10);
    if (!phone) {
      router.replace(`${loginHref}?next=${encodeURIComponent(nextPath)}`);
      return;
    }

    let ignore = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const loadMessages = async (trustedPhone: string, shouldMarkRead = true) => {
      const messageRes = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_get_messages",
          ActorType: actorType,
          ThreadID: threadId,
          ...(actorType === "provider"
            ? { loggedInProviderPhone: trustedPhone }
            : { UserPhone: trustedPhone }),
        }),
      });
      const messageData = (await messageRes.json()) as ChatMessagesResponse;

      if (!messageRes.ok || !messageData.ok) {
        throw new Error(messageData.error || "Unable to load messages.");
      }

      if (ignore) return;
      setThread(messageData.thread || null);
      setMessages(Array.isArray(messageData.messages) ? messageData.messages : []);

      if (shouldMarkRead) {
        await fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "chat_mark_read",
            ActorType: actorType,
            ThreadID: threadId,
            ...(actorType === "provider"
              ? { loggedInProviderPhone: trustedPhone }
              : { UserPhone: trustedPhone }),
          }),
        });
      }
    };

    const load = async () => {
      setLoading(true);
      setError("");
      setAccessDenied(false);

      try {
        if (actorType === "provider") {
          const profileRes = await fetch(
            `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(phone)}`,
            { cache: "no-store" }
          );
          const profileData = (await profileRes.json()) as ProviderProfileResponse;
          const trustedProviderPhone = String(profileData.provider?.Phone || "")
            .replace(/\D/g, "")
            .slice(-10);

          if (!profileRes.ok || !profileData.ok || !trustedProviderPhone) {
            router.replace(`${loginHref}?next=${encodeURIComponent(nextPath)}`);
            return;
          }

          if (ignore) return;
          setActorPhone(trustedProviderPhone);
          await loadMessages(trustedProviderPhone, true);

          intervalId = setInterval(() => {
            void loadMessages(trustedProviderPhone, true).catch(() => undefined);
          }, 5000);
        } else {
          if (ignore) return;
          setActorPhone(phone);
          await loadMessages(phone, true);

          intervalId = setInterval(() => {
            void loadMessages(phone, true).catch(() => undefined);
          }, 5000);
        }
      } catch (err) {
        if (ignore) return;
        const message = err instanceof Error ? err.message : "Unable to load chat thread.";
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
  }, [actorType, loginHref, nextPath, router, threadId]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages]);

  const sendMessage = async (messageText: string) => {
    const trimmedMessage = messageText.trim();
    if (!thread || !actorPhone || !trimmedMessage || sending) return;
    setSending(true);
    setError("");

    try {
      console.log("[chat/thread] message sent", {
        actorType,
        threadId: thread.ThreadID,
        messageText: trimmedMessage,
      });
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_send_message",
          ActorType: actorType,
          ThreadID: thread.ThreadID,
          ...(actorType === "provider"
            ? { loggedInProviderPhone: actorPhone }
            : { UserPhone: actorPhone }),
          MessageText: trimmedMessage,
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
          ActorType: actorType,
          ThreadID: thread.ThreadID,
          ...(actorType === "provider"
            ? { loggedInProviderPhone: actorPhone }
            : { UserPhone: actorPhone }),
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

  const handleSend = async () => {
    await sendMessage(input);
  };

  const handleQuickReply = async (messageText: string) => {
    console.log("[chat/thread] quick reply clicked", {
      actorType,
      threadId,
      messageText,
    });
    await sendMessage(messageText);
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
            Access denied. This chat thread does not belong to the logged-in account.
          </p>
          <Link
            href={backHref}
            className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back
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
            href={backHref}
            className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back
          </Link>
        </div>
      </main>
    );
  }

  const isClosed = String(thread.Status || "").trim().toLowerCase() === "closed";
  const counterpartyLabel = getCounterpartyLabel(actorType);
  const headerTitle = actorType === "provider" ? "Customer Conversation" : "Provider Conversation";
  const headerSubtitle =
    actorType === "provider"
      ? "Respond quickly and keep the customer updated here."
      : "Use this chat to confirm details and coordinate the service.";

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#e0f2fe,transparent_35%),linear-gradient(180deg,#f8fbff_0%,#eef4f8_100%)] px-4 py-6 sm:py-8">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 shadow-[0_20px_60px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="border-b border-slate-200 bg-[linear-gradient(135deg,#0f172a_0%,#1d4ed8_100%)] px-5 py-5 text-white sm:px-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-200">
                  {actorType === "provider" ? "Provider Chat" : "User Chat"}
                </p>
                <h1 className="mt-2 text-2xl font-semibold">{headerTitle}</h1>
                <p className="mt-1 text-sm text-sky-100/90">{headerSubtitle}</p>
              </div>
              <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm text-sky-50">
                <p className="font-medium">Latest activity</p>
                <p className="mt-1 text-sm text-sky-100">{formatHeaderTimestamp(thread.LastMessageAt)}</p>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2 text-xs text-sky-100/90">
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">
                Status: {thread.Status || "active"}
              </span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">
                Viewing as: {actorType === "provider" ? "Provider" : "User"}
              </span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">
                {getTaskDisplayLabel(thread, thread.TaskID)}
              </span>
              <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1">
                Thread ID: {thread.ThreadID}
              </span>
            </div>
          </div>

          <div className="border-b border-slate-200 bg-slate-50/70 px-5 py-3 text-sm text-slate-600 sm:px-6">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span>
                <span className="font-semibold text-slate-900">Other side:</span> {counterpartyLabel}
              </span>
              {thread.ProviderID ? (
                <span>
                  <span className="font-semibold text-slate-900">Provider ID:</span> {thread.ProviderID}
                </span>
              ) : null}
              {thread.UserPhone ? (
                <span>
                  <span className="font-semibold text-slate-900">User:</span> ending in{" "}
                  {thread.UserPhone.slice(-4)}
                </span>
              ) : null}
            </div>
          </div>

          {isClosed ? (
            <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm font-medium text-amber-800 sm:px-6">
              This chat is closed. You can still review the conversation history.
            </div>
          ) : null}

          {error ? (
            <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700 sm:px-6">
              {error}
            </div>
          ) : null}
        </div>

        <div className="overflow-hidden rounded-[28px] border border-slate-200/80 bg-white/95 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
          <div
            ref={scrollRef}
            className="h-[62vh] space-y-4 overflow-y-auto bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] px-4 py-5 sm:px-6"
          >
            {messages.length === 0 ? (
              <div className="flex h-full min-h-[280px] items-center justify-center">
                <div className="max-w-sm rounded-3xl border border-dashed border-slate-300 bg-slate-50 px-6 py-8 text-center">
                  <p className="text-base font-semibold text-slate-900">No messages yet</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">
                    Start the conversation to confirm details, timing, and anything the other side
                    should know before the service.
                  </p>
                </div>
              </div>
            ) : (
              messages.map((message) => {
                const senderType = String(message.SenderType || "").trim().toLowerCase();
                const isOwnMessage =
                  (actorType === "provider" && senderType === "provider") ||
                  (actorType === "user" && senderType === "user");
                const senderLabel = isOwnMessage ? "You" : counterpartyLabel;

                return (
                  <div
                    key={message.MessageID}
                    className={`flex ${isOwnMessage ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-[22px] px-4 py-3 shadow-sm sm:max-w-[75%] ${
                        isOwnMessage
                          ? "rounded-br-md bg-[linear-gradient(135deg,#0284c7_0%,#2563eb_100%)] text-white"
                          : "rounded-bl-md border border-slate-200 bg-white text-slate-900"
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <p
                          className={`text-[11px] font-semibold uppercase tracking-[0.2em] ${
                            isOwnMessage ? "text-sky-100/90" : "text-slate-500"
                          }`}
                        >
                          {senderLabel}
                        </p>
                        <span
                          className={`text-[11px] ${
                            isOwnMessage ? "text-sky-100/80" : "text-slate-400"
                          }`}
                        >
                          {formatMessageTimestamp(message.CreatedAt)}
                        </span>
                      </div>
                      <p
                        className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${
                          isOwnMessage ? "text-white" : "text-slate-800"
                        }`}
                      >
                        {message.MessageText}
                      </p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="border-t border-slate-200 bg-white px-4 py-4 sm:px-6">
            <div className="mb-3">
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  Quick Replies
                </p>
                <p className="text-xs text-slate-400">Tap to send instantly</p>
              </div>
              <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
                {quickReplies.map((reply) => (
                  <button
                    key={reply}
                    type="button"
                    onClick={() => void handleQuickReply(reply)}
                    disabled={sending || isClosed}
                    className="shrink-0 rounded-full border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 hover:text-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {reply}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => void handleQuickReply(buildSharePhoneReply(actorPhone))}
                  disabled={sending || isClosed || !actorPhone}
                  className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Share my phone number
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
                placeholder={
                  isClosed
                    ? "This conversation is closed"
                    : `Message ${counterpartyLabel.toLowerCase()}`
                }
                rows={3}
                className="min-h-[84px] flex-1 rounded-2xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-sky-500 focus:bg-white"
              />
              <div className="flex items-center justify-between gap-3 sm:w-auto sm:flex-col sm:items-end">
                <p className="text-xs text-slate-500">
                  {isClosed ? "Closed conversation" : "Press Enter to send, Shift+Enter for a new line"}
                </p>
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={sending || isClosed || !trimmedInput}
                  className="inline-flex min-w-28 items-center justify-center rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  {sending ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
