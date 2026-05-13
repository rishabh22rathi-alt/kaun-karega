"use client";

import Link from "next/link";
import { BadgeCheck, ChevronLeft, Phone, Send } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

type Thread = {
  ThreadID: string;
  TaskID: string;
  DisplayID?: string;
  UserPhone: string;
  ProviderID: string;
  ProviderPhone?: string;
  // Hydrated server-side from `providers` row by mapThreadRow. Only sent
  // to authorized participants (the A2 access gate runs before the payload
  // is built). Empty when the provider row is missing.
  ProviderName?: string;
  ProviderVerified?: "yes" | "no" | "";
  LastMessageAt?: string;
  Status?: string;
  // Surfaced in the new compact header as the secondary line:
  //   "<Category> · <Area>" (with display-label fallback when both empty).
  // The chat_get_messages payload already returns these on ChatThreadPayload.
  Category?: string;
  Area?: string;
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
  // Stage-1 backend addition: when the page omits ActorType (auto-mode),
  // the backend echoes the resolved actor here so the page can pin it for
  // subsequent send/mark-read calls.
  actorType?: "user" | "provider";
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
  // Actor type is no longer read from `?actor=user`. The backend infers it
  // from the session phone vs. chat_threads row (Stage 1) and echoes the
  // resolved value back in the chat_get_messages response — we pin that
  // here for subsequent send/mark-read calls.
  const [actorType, setActorType] = useState<"user" | "provider" | null>(null);
  const [actorPhone, setActorPhone] = useState("");
  const [thread, setThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [accessDenied, setAccessDenied] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);
  const justSentRef = useRef(false);
  // backHref defaults to home pre-resolution and during access-denied; once
  // the actor is known it points at the appropriate dashboard.
  const backHref =
    actorType === "user"
      ? "/dashboard/my-requests"
      : actorType === "provider"
        ? "/provider/dashboard"
        : "/";
  const trimmedInput = input.trim();
  const quickReplies = actorType === "provider" ? PROVIDER_QUICK_REPLIES : USER_QUICK_REPLIES;

  useEffect(() => {
    if (!threadId) {
      setError("Missing thread ID.");
      setLoading(false);
      return;
    }

    // Generic login path — actor-agnostic. Backend auto-resolves on return.
    const loginHref = "/login";
    const nextPath = `/chat/thread/${threadId}`;

    const session = getAuthSession();
    const phone = String(session?.phone || "").replace(/\D/g, "").slice(-10);
    if (!phone) {
      router.replace(`${loginHref}?next=${encodeURIComponent(nextPath)}`);
      return;
    }

    let ignore = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    // Polling helper. Once the actor is resolved on first load, every
    // subsequent get/mark goes through the explicit-mode resolver with the
    // pinned ActorType — same payload shape the page used before Stage 2.
    const loadMessages = async (
      knownActorType: "user" | "provider",
      sessionPhone: string,
      shouldMarkRead = true
    ) => {
      const messageRes = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_get_messages",
          ActorType: knownActorType,
          ThreadID: threadId,
          ...(knownActorType === "provider"
            ? { loggedInProviderPhone: sessionPhone }
            : { UserPhone: sessionPhone }),
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
            ActorType: knownActorType,
            ThreadID: threadId,
            ...(knownActorType === "provider"
              ? { loggedInProviderPhone: sessionPhone }
              : { UserPhone: sessionPhone }),
          }),
        });
      }
    };

    // Single helper used by every failure path — initial fetch, JSON
    // parse, ok:false, missing-thread, missing-actor, and the 5s
    // poll. Wipes ALL chat-derived state so a previously-rendered
    // authorized thread cannot leak across route changes, and pins
    // the denial UI as the only visible branch. The server already
    // collapses "unauthorized for this thread" and "thread doesn't
    // exist" into a single "Thread not found" response so existence
    // isn't leaked; the client mirrors that by showing one denial
    // UI for either case rather than echoing the raw server text.
    const denyAndClear = (): void => {
      setAccessDenied(true);
      setError("");
      setActorType(null);
      setActorPhone("");
      setThread(null);
      setMessages([]);
    };

    const load = async () => {
      setLoading(true);
      setError("");
      setAccessDenied(false);
      // Clear chat state up-front. Without this, navigating from an
      // authorized thread to an unauthorized one keeps the previous
      // thread / messages / actor in memory while the new fetch is
      // in flight. The `loading=true` guard above blocks visible
      // render today, but clearing here is defense-in-depth so a
      // future render branch can never accidentally surface stale
      // bubbles, composer, participant names, or previews.
      setActorType(null);
      setActorPhone("");
      setThread(null);
      setMessages([]);

      try {
        // First load uses Stage-1 auto-mode: no ActorType, just SessionPhone.
        // Backend looks up the thread, compares session phone to the row's
        // user_phone / provider_phone, and replies with the resolved actor.
        const initialRes = await fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "chat_get_messages",
            ThreadID: threadId,
            SessionPhone: phone,
          }),
        });
        let initialData: ChatMessagesResponse = {};
        try {
          initialData = (await initialRes.json()) as ChatMessagesResponse;
        } catch {
          initialData = {};
        }

        // Any server-rejected response — 401, 403, 404, 5xx, or 200
        // with ok:false — is treated as denial. The page MUST NOT
        // render chat bubbles, composer, or participant identity
        // for a thread it failed to authorize against.
        if (!initialRes.ok || !initialData.ok) {
          if (ignore) return;
          denyAndClear();
          return;
        }

        // Even an ok:true response is denied if the server didn't
        // resolve an actor or didn't include a thread — both signal
        // that authorization wasn't conclusively confirmed.
        const resolved = initialData.actorType;
        if (
          (resolved !== "user" && resolved !== "provider") ||
          !initialData.thread
        ) {
          if (ignore) return;
          denyAndClear();
          return;
        }

        if (ignore) return;
        setActorType(resolved);
        setActorPhone(phone);
        setThread(initialData.thread);
        setMessages(Array.isArray(initialData.messages) ? initialData.messages : []);

        // Mark read once on initial load using the resolved actor.
        await fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "chat_mark_read",
            ActorType: resolved,
            ThreadID: threadId,
            ...(resolved === "provider"
              ? { loggedInProviderPhone: phone }
              : { UserPhone: phone }),
          }),
        });

        intervalId = setInterval(() => {
          // Poll failure path now matches the initial-load path:
          // any failure (auth state changed, thread closed, network
          // blip) collapses to denial + stops the interval. Stale
          // bubbles never linger past a failure.
          void loadMessages(resolved, phone, true).catch(() => {
            if (ignore) return;
            denyAndClear();
            if (intervalId) {
              clearInterval(intervalId);
              intervalId = null;
            }
          });
        }, 5000);
      } catch (err) {
        if (ignore) return;
        // Network / unexpected throw — can't verify authorization,
        // therefore must not render chat. The raw error string is
        // intentionally NOT surfaced (it can carry server-side hints
        // that distinguish "doesn't exist" from "unauthorized").
        void err;
        denyAndClear();
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
    const node = scrollRef.current;
    if (!node) return;
    if (justSentRef.current || nearBottomRef.current) {
      node.scrollTop = node.scrollHeight;
    }
    justSentRef.current = false;
  }, [messages]);

  const handleScrollContainerScroll = () => {
    const node = scrollRef.current;
    if (!node) return;
    const NEAR_BOTTOM_THRESHOLD = 80;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    nearBottomRef.current = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD;
  };

  const sendMessage = async (messageText: string) => {
    const trimmedMessage = messageText.trim();
    // actorType is set by the initial auto-resolve on load; sends are
    // disabled in the UI until then (see Send button + quick-reply guards).
    if (!thread || !actorPhone || !actorType || !trimmedMessage || sending) return;
    const resolvedActor = actorType;
    setSending(true);
    setError("");

    try {
      console.log("[chat/thread] message sent", {
        actorType: resolvedActor,
        threadId: thread.ThreadID,
        messageText: trimmedMessage,
      });
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_send_message",
          ActorType: resolvedActor,
          ThreadID: thread.ThreadID,
          ...(resolvedActor === "provider"
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
          ActorType: resolvedActor,
          ThreadID: thread.ThreadID,
          ...(resolvedActor === "provider"
            ? { loggedInProviderPhone: actorPhone }
            : { UserPhone: actorPhone }),
        }),
      });
      const refreshData = (await refreshRes.json()) as ChatMessagesResponse;
      if (refreshRes.ok && refreshData.ok) {
        setThread(refreshData.thread || thread);
        justSentRef.current = true;
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

  if (error || !thread || !actorType) {
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
  // Header identity. When the user is the actor, surface the provider's
  // name / phone / verified status. When the actor is the provider, the
  // counterparty is the customer — we don't have a name for that side, so
  // we fall back to "Customer".
  const providerName = String(thread.ProviderName || "").trim();
  const providerPhone = String(thread.ProviderPhone || "").replace(/\D/g, "").slice(-10);
  const providerVerified = thread.ProviderVerified === "yes";
  const titleLine =
    actorType === "provider"
      ? "Customer"
      : providerName || "Service Provider";
  const subtitleLine =
    [String(thread.Category || "").trim(), String(thread.Area || "").trim()]
      .filter(Boolean)
      .join(" · ");
  const avatarInitial =
    actorType === "provider"
      ? "C"
      : (providerName ? providerName.trim().charAt(0).toUpperCase() : "P") || "P";
  const sendButtonReady = Boolean(trimmedInput) && !sending && !isClosed;
  const sendButtonDisabled = sending || isClosed || !trimmedInput;

  return (
    <main className="flex h-[100dvh] flex-col bg-slate-50">
      {/* Compact branded header — single row, ~56-64px tall on the chrome
          line. The body block can run two short text lines (title +
          category/area) plus an inline metadata strip (phone + verified
          chip) when the actor is a user viewing a provider thread. All
          text uses `truncate`/`flex min-w-0` so a long provider name
          collapses gracefully on narrow viewports. */}
      <header className="flex shrink-0 items-center gap-3 bg-[#003d20] px-3 py-2.5 text-white sm:px-4 sm:py-3">
        <Link
          href={backHref}
          aria-label="Back"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10"
        >
          <ChevronLeft className="h-5 w-5" />
        </Link>
        <div
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-100 text-base font-bold text-[#003d20]"
        >
          {avatarInitial}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold uppercase tracking-wide text-white sm:text-base">
            {titleLine}
          </p>
          {subtitleLine ? (
            <p className="truncate text-xs text-white/80 sm:text-sm">
              {subtitleLine}
            </p>
          ) : null}
          {/* Identity metadata strip — phone + verified chip — only when
              the actor is a user (provider-side actor sees a generic
              "Customer" header with no PII to surface). The phone line
              renders only when the server returned a 10-digit value;
              that field is gated by the same A2 access check that
              controls the rest of the payload. */}
          {actorType === "user" && (providerPhone || providerVerified) ? (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-white/80 sm:text-xs">
              {providerPhone ? (
                <a
                  href={`tel:${providerPhone}`}
                  className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 font-medium transition hover:bg-white/20"
                >
                  <Phone className="h-3 w-3" aria-hidden="true" />
                  <span className="font-mono">{providerPhone}</span>
                </a>
              ) : null}
              {providerVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 font-medium text-emerald-100">
                  <BadgeCheck className="h-3 w-3" aria-hidden="true" />
                  Verified
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        {isClosed ? (
          <span className="ml-auto shrink-0 self-start rounded-full bg-amber-100 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-900">
            Closed
          </span>
        ) : null}
      </header>

      {/* Slim error strip — appears only when send/load surfaced an error. */}
      {error ? (
        <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 sm:px-4">
          {error}
        </div>
      ) : null}

      {/* Messages region — the only scrollable surface. flex-1 + min-h-0 lets
          this child shrink below its content size and become the scroll
          container; the header above and composer below stay pinned. */}
      <div
        ref={scrollRef}
        onScroll={handleScrollContainerScroll}
        className="flex-1 min-h-0 overflow-y-auto bg-slate-50 px-3 py-3 sm:px-4"
      >
        <div className="mx-auto w-full max-w-3xl space-y-3">
          {messages.length === 0 ? (
            <div className="flex min-h-[40vh] items-center justify-center">
              <div className="max-w-sm rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-8 text-center">
                <p className="text-base font-semibold text-slate-900">
                  No messages yet
                </p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Start the conversation to confirm details, timing, and anything the
                  other side should know before the service.
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
                    className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm sm:max-w-[70%] ${
                      isOwnMessage
                        ? "rounded-br-md bg-[#003d20] text-white"
                        : "rounded-bl-md border border-slate-200 bg-white text-slate-900"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <p
                        className={`text-[10px] font-semibold uppercase tracking-[0.18em] ${
                          isOwnMessage ? "text-white/80" : "text-slate-500"
                        }`}
                      >
                        {senderLabel}
                      </p>
                      <span
                        className={`text-[10px] ${
                          isOwnMessage ? "text-white/70" : "text-slate-400"
                        }`}
                      >
                        {formatMessageTimestamp(message.CreatedAt)}
                      </span>
                    </div>
                    <p
                      className={`mt-1 whitespace-pre-wrap text-sm leading-6 ${
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
      </div>

      {/* Composer dock — pinned at bottom by flex column. shrink-0 keeps it
          visible above the soft keyboard; safe-area inset prevents the home
          indicator from overlapping the send button on iOS. */}
      <footer className="shrink-0 border-t border-slate-200 bg-white">
        <div className="mx-auto w-full max-w-3xl px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:px-4">
          {/* Quick replies — single horizontal row, no header. Brand-tinted
              chips replace the slate/sky styling. */}
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
            {quickReplies.map((reply) => (
              <button
                key={reply}
                type="button"
                onClick={() => void handleQuickReply(reply)}
                disabled={sending || isClosed}
                className="shrink-0 rounded-full border border-[#003d20]/20 bg-[#003d20]/5 px-3 py-1.5 text-xs font-medium text-[#003d20] transition hover:border-[#003d20]/40 hover:bg-[#003d20]/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reply}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void handleQuickReply(buildSharePhoneReply(actorPhone))}
              disabled={sending || isClosed || !actorPhone}
              className="shrink-0 rounded-full border border-[#003d20]/20 bg-white px-3 py-1.5 text-xs font-semibold text-[#003d20] transition hover:border-[#003d20]/40 hover:bg-[#003d20]/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Share my phone number
            </button>
          </div>

          {/* Single-line textarea + circular send button. text-base (16px)
              keeps iOS Safari from auto-zooming the input on focus. The
              textarea grows organically up to max-h-[120px]. */}
          <div className="flex items-end gap-2">
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
              rows={1}
              className="min-h-[44px] max-h-[120px] flex-1 resize-none rounded-2xl border border-slate-300 bg-slate-50 px-4 py-2.5 text-base text-slate-900 outline-none transition focus:border-[#003d20] focus:bg-white"
            />
            {/*
              Send button colour states (per approved design):
              - empty / closed / sending → disabled, slate-300
              - has trimmed text + idle  → orange (ready-to-send highlight)
              - has trimmed text + sending → forest green with spinner
            */}
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={sendButtonDisabled}
              aria-label={sending ? "Sending message" : "Send message"}
              className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition disabled:cursor-not-allowed disabled:bg-slate-300 ${
                sendButtonReady
                  ? "bg-[#f97316] hover:bg-[#ea670e]"
                  : "bg-[#003d20] hover:bg-[#00542b]"
              }`}
            >
              {sending ? (
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              ) : (
                <Send className="h-5 w-5" />
              )}
            </button>
          </div>
        </div>
      </footer>
    </main>
  );
}
