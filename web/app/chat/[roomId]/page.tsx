"use client";

import { Suspense } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

type Message = {
  roomId: string;
  sender: string;
  message: string;
  timestamp: string;
};

type ChatRoom = {
  roomId: string;
  taskId: string;
  userPhone: string;
  providerPhone: string;
  status: string;
  createdAt: string;
  expiresAt: string;
};

type ListResponse = {
  ok: boolean;
  messages?: Message[];
  expired?: boolean;
  chatRoom?: ChatRoom;
  error?: string;
};

type PageProps = {
  params: { roomId: string };
};

export default function ChatPage({ params }: PageProps) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-8">
          <div className="rounded-xl bg-white shadow-lg px-6 py-4 text-sm text-slate-700">
            Loading chat...
          </div>
        </main>
      }
    >
      <PageContent params={params} />
    </Suspense>
  );
}

function PageContent({ params }: PageProps) {
  const { roomId } = params;
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(true);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState("");
  const [chatRoom, setChatRoom] = useState<ChatRoom | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("");
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewText, setReviewText] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewSubmitted, setReviewSubmitted] = useState(false);
  const [reviewDuplicate, setReviewDuplicate] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const samePhone = (a: string, b: string) => {
    if (!a || !b) return false;
    const cleanA = a.replace(/\D/g, "").slice(-10);
    const cleanB = b.replace(/\D/g, "").slice(-10);
    return cleanA !== "" && cleanA === cleanB;
  };

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth",
      });
    });
  };

  useEffect(() => {
    const storedPhone =
      localStorage.getItem("kk_user_phone") ||
      localStorage.getItem("kk_phone") ||
      "";
    const storedRole =
      localStorage.getItem("kk_user_role") ||
      localStorage.getItem("kk_role") ||
      "";

    if (!storedPhone) {
      const parts = roomId.split("-");
      const taskId = parts[0] || "";
      const providerPhone = parts.slice(1).join("-") || "";
      const redirectPath =
        taskId && providerPhone
          ? `/login?redirectTo=${encodeURIComponent(
              `/chat?taskId=${taskId}&provider=${providerPhone}`
            )}`
          : `/login?redirectTo=${encodeURIComponent(`/chat/${roomId}`)}`;
      window.location.href = redirectPath;
      return;
    }

    setPhone(storedPhone);
    setRole(storedRole);
    setAuthChecked(true);
  }, [roomId]);

  useEffect(() => {
    if (!authChecked) return;

    let active = true;

    const fetchMessages = async (initial = false) => {
      try {
        const res = await fetch("/api/messages/list", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ roomId }),
        });
        const data: ListResponse = await res.json();
        if (!active) return;
        if (!data.ok || !data.chatRoom) {
          setError(data.error || "Unable to load chat");
          setLoading(false);
          return;
        }

        const allowed =
          role === "admin" ||
          samePhone(data.chatRoom.userPhone, phone) ||
          samePhone(data.chatRoom.providerPhone, phone);

        if (!allowed) {
          setError("You are not allowed to open this chat.");
          setLoading(false);
          return;
        }

        setChatRoom(data.chatRoom);
        setMessages(data.messages || []);
        setExpired(Boolean(data.expired));
        setLoading(false);
        if (initial) {
          scrollToBottom();
        } else {
          scrollToBottom();
        }
      } catch (err) {
        if (active) {
          setError("Failed to load messages");
          setLoading(false);
        }
      }
    };

    fetchMessages(true);
    intervalRef.current = setInterval(fetchMessages, 3000);

    return () => {
      active = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [authChecked, phone, role, roomId]);

  const sendMessage = async () => {
    if (!input.trim() || expired) return;
    const sender = samePhone(phone, chatRoom?.userPhone || "")
      ? "user"
      : samePhone(phone, chatRoom?.providerPhone || "")
        ? "provider"
        : "user";
    const body = input.trim();
    setInput("");
    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, sender, message: body }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || "Failed to send message");
        if (data.expired) {
          setExpired(true);
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
      scrollToBottom();
    } catch (err) {
      setError("Network error. Please try again.");
    }
  };

  const reviewerRole = useMemo(() => {
    if (!chatRoom) return "";
    if (samePhone(phone, chatRoom.userPhone)) return "user";
    if (samePhone(phone, chatRoom.providerPhone)) return "provider";
    return role === "admin" ? "admin" : "";
  }, [chatRoom, phone, role]);

  useEffect(() => {
    if (!chatRoom || !phone) return;
    let cancelled = false;
    const loadReview = async () => {
      try {
        const res = await fetch(
          `/api/reviews/submit?roomId=${encodeURIComponent(
            chatRoom.roomId
          )}&reviewerPhone=${encodeURIComponent(phone)}`
        );
        const data = await res.json();
        if (cancelled) return;
        if (data?.review) {
          setReviewSubmitted(true);
          setReviewDuplicate(true);
          if (data.review.rating) {
            const parsed = parseInt(data.review.rating, 10);
            if (!Number.isNaN(parsed)) {
              setReviewRating(parsed);
            }
          }
          if (data.review.reviewText) {
            setReviewText(data.review.reviewText);
          }
        }
      } catch {
        /* ignore */
      }
    };
    loadReview();
    return () => {
      cancelled = true;
    };
  }, [chatRoom, phone]);

  const getColorForRating = (rating: number) => {
    if (rating <= 1) return "text-red-500";
    if (rating <= 3) return "text-orange-500";
    return "text-green-500";
  };

  const submitReview = async () => {
    if (!chatRoom || !reviewerRole || reviewerRole === "admin") return;
    if (reviewRating < 1 || reviewRating > 5) {
      setError("Please select a rating");
      return;
    }
    setReviewSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/reviews/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roomId: chatRoom.roomId,
          reviewerPhone: phone,
          reviewerRole,
          rating: reviewRating,
          reviewText,
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setReviewSubmitted(true);
        setReviewDuplicate(false);
      } else if (data.duplicate) {
        setReviewDuplicate(true);
        setReviewSubmitted(true);
      } else {
        setError(data.error || "Failed to submit review");
      }
    } catch (err) {
      setError("Network error. Please try again.");
    } finally {
      setReviewSubmitting(false);
    }
  };

  const formatTime = (iso: string) => {
    if (!iso) return "";
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  };

  return (
    <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl space-y-3">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-[#0EA5E9]">Kaun Karega – Chat</h1>
          {expired && (
            <p className="mt-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              ⚠️ This chat expired after 24 hours.
            </p>
          )}
          {error && !loading && (
            <p className="mt-2 text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-lg h-[75vh] flex flex-col">
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 space-y-3"
          >
            {loading && <p className="text-sm text-gray-500">Loading messages...</p>}
            {!loading &&
              messages.map((msg, idx) => {
                const isUser = msg.sender === "user";
                return (
                  <div
                    key={`${msg.timestamp}-${idx}`}
                    className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                  >
                    <div className="max-w-[80%]">
                      <p className="text-xs text-gray-500 mb-1">
                        {msg.sender === "user" ? "User" : "Provider"}
                      </p>
                      <div className="bg-white rounded-lg shadow-sm p-3 border border-gray-100">
                        <p className="text-sm text-gray-800">{msg.message}</p>
                        <p className="text-[10px] text-gray-400 text-right mt-2">
                          {formatTime(msg.timestamp)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>

          <div className="border-t border-gray-100 bg-white p-3 shadow-sm rounded-b-2xl">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                className="flex-1 rounded-full border border-gray-200 px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5E9] shadow-sm"
                placeholder={expired ? "Chat expired" : "Type a message"}
                disabled={expired || !!error}
              />
              <button
                type="button"
                onClick={sendMessage}
                disabled={expired || !!error || !input.trim()}
                className="rounded-full bg-[#0EA5E9] text-white px-4 py-2 text-sm font-semibold shadow-md hover:bg-[#0b8ac2] disabled:opacity-60"
              >
                Send
              </button>
            </div>
          </div>
        </div>

        {expired && !error && reviewerRole !== "admin" && (
          <div className="bg-white rounded-2xl shadow-lg p-6 space-y-4">
            {!reviewSubmitted ? (
              <>
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold text-[#111827]">
                    {reviewerRole === "user"
                      ? "Rate your experience with Service Provider"
                      : "Rate your experience with the Customer"}
                  </h2>
                  <p className="text-sm text-gray-500">
                    Share feedback to improve the experience.
                  </p>
                </div>
                <div className="flex items-center space-x-1">
                  {[1, 2, 3, 4, 5].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setReviewRating(num)}
                      className={`h-8 w-8 text-2xl ${
                        num <= reviewRating
                          ? getColorForRating(reviewRating || num)
                          : "text-gray-300"
                      }`}
                    >
                      ★
                    </button>
                  ))}
                </div>
                <textarea
                  value={reviewText}
                  onChange={(e) => setReviewText(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 bg-white shadow-sm p-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#0EA5E9]"
                  rows={3}
                  placeholder="Write your review (optional)"
                  disabled={reviewSubmitting}
                />
                <button
                  type="button"
                  onClick={submitReview}
                  disabled={reviewSubmitting || reviewRating < 1}
                  className="w-full rounded-full bg-green-500 hover:bg-green-600 text-white font-semibold py-3 disabled:opacity-60"
                >
                  {reviewSubmitting ? "Submitting..." : "Submit Review"}
                </button>
                {reviewDuplicate && (
                  <p className="text-sm text-orange-600 bg-orange-50 border border-orange-100 rounded-lg p-3">
                    Review already submitted.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg p-3">
                Thank you for your feedback!
              </p>
            )}
          </div>
        )}

        {/* TODO (Phase 5):
        If kk_role === "admin", show full chat + both reviews */}
      </div>
    </main>
  );
}
