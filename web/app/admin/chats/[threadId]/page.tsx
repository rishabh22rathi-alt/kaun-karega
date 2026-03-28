"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getTaskDisplayLabel } from "@/lib/taskDisplay";

type PageProps = {
  params: {
    threadId: string;
  };
};

type ThreadRow = {
  ThreadID: string;
  TaskID: string;
  DisplayID?: string;
  UserPhone: string;
  ProviderID: string;
  LastMessage: string;
  LastMessageAt: string;
  Status: string;
  ClosedBy: string;
  ClosedAt: string;
  BlockedFlag: string;
  BlockedReason: string;
  LastSenderType: string;
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
};

function formatDisplayDate(value: string) {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toLocaleString();
  }
  return value;
}

export default function AdminChatDetailPage({ params }: PageProps) {
  const threadId = decodeURIComponent(params.threadId || "").trim();
  const [thread, setThread] = useState<ThreadRow | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);

  const loadDetail = async () => {
    setLoading(true);
    setError("");

    try {
      const threadRes = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get_admin_chat_threads",
        }),
      });
      const threadData = await threadRes.json();

      if (!threadRes.ok || !threadData?.ok) {
        throw new Error(threadData?.error || "Unable to load chat thread.");
      }

      const matchedThread = Array.isArray(threadData?.threads)
        ? threadData.threads.find((item: ThreadRow) => String(item.ThreadID || "").trim() === threadId) || null
        : null;

      if (!matchedThread) {
        throw new Error("Chat thread not found.");
      }

      const messageRes = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get_chat_messages",
          ThreadID: threadId,
        }),
      });
      const messageData = await messageRes.json();

      if (!messageRes.ok || !messageData?.ok) {
        throw new Error(messageData?.error || "Unable to load chat messages.");
      }

      setThread(matchedThread);
      setMessages(Array.isArray(messageData?.messages) ? messageData.messages : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load chat detail.");
      setThread(null);
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDetail();
  }, [threadId]);

  const handleCloseChat = async () => {
    if (!threadId) return;

    setActionLoading(true);
    setError("");

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close_chat_thread",
          ThreadID: threadId,
          ClosedBy: "admin",
        }),
      });
      const data = await res.json();

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Unable to close chat.");
      }

      await loadDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to close chat.");
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-600">Loading chat detail...</p>
      </div>
    );
  }

  if (error || !thread) {
    return (
      <div className="space-y-4">
        <Link href="/admin/chats" className="text-sm font-semibold text-sky-700">
          Back to Chats
        </Link>
        <div className="rounded-lg border border-rose-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-rose-600">{error || "Chat thread not found."}</p>
        </div>
      </div>
    );
  }

  const isClosed = String(thread.Status || "").trim().toLowerCase() === "closed";

  return (
    <div className="space-y-4">
      <Link href="/admin/chats" className="text-sm font-semibold text-sky-700">
        Back to Chats
      </Link>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 text-sm text-slate-700">
            <p><span className="font-semibold text-slate-900">ThreadID:</span> {thread.ThreadID}</p>
            <p>
              <span className="font-semibold text-slate-900">Kaam:</span>{" "}
              {getTaskDisplayLabel(thread, thread.TaskID)}
            </p>
            <p><span className="font-semibold text-slate-900">UserPhone:</span> {thread.UserPhone || "-"}</p>
            <p><span className="font-semibold text-slate-900">ProviderID:</span> {thread.ProviderID || "-"}</p>
            <p><span className="font-semibold text-slate-900">Status:</span> {thread.Status || "-"}</p>
            <p><span className="font-semibold text-slate-900">ClosedBy:</span> {thread.ClosedBy || "-"}</p>
            <p><span className="font-semibold text-slate-900">ClosedAt:</span> {formatDisplayDate(thread.ClosedAt)}</p>
            <p><span className="font-semibold text-slate-900">BlockedFlag:</span> {thread.BlockedFlag || "-"}</p>
            <p><span className="font-semibold text-slate-900">BlockedReason:</span> {thread.BlockedReason || "-"}</p>
            <p><span className="font-semibold text-slate-900">LastSenderType:</span> {thread.LastSenderType || "-"}</p>
          </div>

          {!isClosed ? (
            <button
              type="button"
              onClick={() => void handleCloseChat()}
              disabled={actionLoading}
              className="rounded bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {actionLoading ? "Closing..." : "Close Chat"}
            </button>
          ) : null}
        </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-900">Messages</h2>
        {messages.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No messages found.</p>
        ) : (
          <div className="mt-4 space-y-3">
            {messages.map((message) => (
              <div key={message.ChatID} className="rounded border border-slate-200 p-3 text-sm">
                <p className="font-semibold text-slate-900">{message.SenderType || "-"}</p>
                <p className="mt-1 whitespace-pre-wrap text-slate-700">{message.MessageText || "-"}</p>
                <p className="mt-2 text-xs text-slate-500">{formatDisplayDate(message.CreatedAt)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
