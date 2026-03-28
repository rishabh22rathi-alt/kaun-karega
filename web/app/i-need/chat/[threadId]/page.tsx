"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

import { getAuthSession } from "@/lib/auth";

type MessageRole = "poster" | "responder";

type Message = {
  id: string;
  role: MessageRole;
  text: string;
  time: string;
};

type NeedChatThread = {
  ThreadID: string;
  NeedID: string;
  PosterPhone: string;
  ResponderPhone: string;
  Status?: string;
  LastMessageAt?: string;
};

type NeedChatMessage = {
  MessageID?: string;
  SenderRole?: string;
  MessageText?: string;
  CreatedAt?: string;
};

type NeedChatMessagesResponse = {
  ok?: boolean;
  thread?: NeedChatThread;
  messages?: NeedChatMessage[];
  error?: string;
  message?: string;
};

type NeedChatSendResponse = {
  ok?: boolean;
  thread?: NeedChatThread;
  message?: NeedChatMessage;
  error?: string;
};

function normalizePhoneToTen(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits.slice(-10);
}

function getUserPhone(): string {
  const session = getAuthSession();
  if (session?.phone) return normalizePhoneToTen(session.phone);
  return "";
}

function mapBackendMessageToUi(message: NeedChatMessage): Message | null {
  const role = String(message.SenderRole || "").trim().toLowerCase();
  if (role !== "poster" && role !== "responder") return null;

  return {
    id: String(message.MessageID || `${role}-${message.CreatedAt || Date.now()}`),
    role,
    text: String(message.MessageText || "").trim(),
    time: String(message.CreatedAt || "").trim(),
  };
}

function MessageBubble({ message }: { message: Message }) {
  const isPoster = message.role === "poster";

  return (
    <div className={`flex ${isPoster ? "justify-end" : "justify-start"}`}>
      <div
        className={`flex max-w-[78%] flex-col gap-1 sm:max-w-[65%] ${
          isPoster ? "items-end" : "items-start"
        }`}
      >
        <div
          className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
            isPoster
              ? "rounded-br-sm bg-violet-600 text-white"
              : "rounded-bl-sm border border-slate-200 bg-white text-slate-800"
          }`}
        >
          {message.text}
        </div>
        <span className="px-1 text-[10px] text-slate-400">{message.time}</span>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <div className="text-center">
        <svg className="mx-auto h-6 w-6 animate-spin text-violet-400" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
        <p className="mt-3 text-sm text-slate-500">Loading conversation...</p>
      </div>
    </div>
  );
}

function ErrorState({ message, onBack }: { message: string; onBack: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <div className="w-full max-w-sm rounded-2xl border border-rose-100 bg-rose-50 px-5 py-8 text-center">
        <p className="text-sm font-semibold text-rose-700">Unable to load conversation</p>
        <p className="mt-1 text-sm text-rose-600">{message}</p>
        <button
          type="button"
          onClick={onBack}
          className="mt-5 rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          Go back
        </button>
      </div>
    </div>
  );
}

function EmptyConversation() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <div className="text-3xl">💬</div>
      <p className="mt-3 text-sm font-semibold text-slate-700">No messages yet</p>
      <p className="mt-1 text-xs text-slate-400">
        Start the conversation by sending a message below.
      </p>
    </div>
  );
}

export default function NeedChatPage() {
  const params = useParams<{ threadId?: string | string[] }>();
  const routeThreadId = Array.isArray(params?.threadId) ? params.threadId[0] : params?.threadId;
  const threadId = decodeURIComponent(String(routeThreadId || "")).trim();
  const router = useRouter();
  const searchParams = useSearchParams();
  const roleParam = String(searchParams.get("role") || "").trim().toLowerCase();
  const actorRole = roleParam === "poster" || roleParam === "responder" ? roleParam : "";

  const [actorPhone, setActorPhone] = useState("");
  const [thread, setThread] = useState<NeedChatThread | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [isSending, setIsSending] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    let isActive = true;

    async function parseJsonResponse(response: Response) {
      const raw = await response.text();
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return null;
      }
    }

    async function loadConversation() {
      if (!threadId) {
        if (isActive) {
          setLoadError("Missing thread ID.");
          setIsLoading(false);
        }
        return;
      }

      if (!actorRole) {
        if (isActive) {
          setLoadError("Invalid conversation role. Please reopen this chat from the correct link.");
          setIsLoading(false);
        }
        return;
      }

      const userPhone = getUserPhone();
      if (!userPhone) {
        const nextPath = `/i-need/chat/${encodeURIComponent(threadId)}?role=${encodeURIComponent(
          actorRole
        )}`;
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
        return;
      }

      if (isActive) {
        setActorPhone(userPhone);
        setIsLoading(true);
        setLoadError("");
      }

      try {
        const response = await fetch("/api/kk", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "need_chat_get_messages",
            ThreadID: threadId,
            ActorRole: actorRole,
            UserPhone: userPhone,
          }),
        });

        const data = (await parseJsonResponse(response)) as NeedChatMessagesResponse | null;
        if (!response.ok || data?.ok !== true) {
          throw new Error(
            String(data?.error || data?.message || "Unable to load conversation.")
          );
        }

        const nextMessages = Array.isArray(data?.messages)
          ? data.messages.map(mapBackendMessageToUi).filter((item): item is Message => item !== null)
          : [];

        if (!isActive) return;
        setThread(data?.thread || null);
        setMessages(nextMessages);

        void fetch("/api/kk", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "need_chat_mark_read",
            ThreadID: threadId,
            ActorRole: actorRole,
            UserPhone: userPhone,
          }),
        });
      } catch (error) {
        if (!isActive) return;
        setLoadError(
          error instanceof Error ? error.message : "Unable to load conversation."
        );
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    void loadConversation();

    return () => {
      isActive = false;
    };
  }, [actorRole, router, threadId]);

  async function handleSend() {
    const text = draft.trim();
    if (!text || isSending || !threadId || !actorRole || !actorPhone) return;

    setIsSending(true);
    setLoadError("");

    try {
      const response = await fetch("/api/kk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "need_chat_send_message",
          ThreadID: threadId,
          ActorRole: actorRole,
          UserPhone: actorPhone,
          MessageText: text,
        }),
      });

      const raw = await response.text();
      let data: NeedChatSendResponse | null = null;

      try {
        data = JSON.parse(raw) as NeedChatSendResponse;
      } catch {
        data = null;
      }

      if (!response.ok || data?.ok !== true) {
        throw new Error(String(data?.error || "Unable to send message."));
      }

      const nextMessage = data?.message ? mapBackendMessageToUi(data.message) : null;
      if (data?.thread) setThread(data.thread);
      if (nextMessage) {
        setMessages((prev) => [...prev, nextMessage]);
      }
      setDraft("");
      textareaRef.current?.focus();
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to send message.");
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  return (
    <div className="flex h-screen flex-col bg-slate-50">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Go back"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-500 transition hover:bg-slate-100"
        >
          <svg
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">Need Conversation</p>
          <p className="truncate text-xs text-slate-400">
            {thread?.NeedID
              ? `Need #${thread.NeedID} • ${actorRole || "unknown"}`
              : threadId
                ? `Thread #${threadId}${actorRole ? ` • ${actorRole}` : ""}`
                : "Loading..."}
          </p>
        </div>
      </header>

      {isLoading ? (
        <LoadingState />
      ) : loadError ? (
        <ErrorState message={loadError} onBack={() => router.back()} />
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <EmptyConversation />
            ) : (
              <div className="mx-auto max-w-2xl space-y-3">
                {messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                <div ref={bottomRef} />
              </div>
            )}
          </div>

          <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3">
            <div className="mx-auto flex max-w-2xl items-end gap-2">
              <textarea
                ref={textareaRef}
                rows={1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message..."
                disabled={isSending}
                className="flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100 disabled:opacity-50"
                style={{ maxHeight: "7rem" }}
              />
              <button
                type="button"
                onClick={() => void handleSend()}
                disabled={!draft.trim() || isSending}
                aria-label="Send message"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <svg
                  className="h-4 w-4 translate-x-px"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2.5}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z"
                  />
                </svg>
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
