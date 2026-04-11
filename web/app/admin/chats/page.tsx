"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getAuthSession } from "@/lib/auth";
import { getTaskDisplayLabel } from "@/lib/taskDisplay";

type ThreadRow = {
  ThreadID: string;
  TaskID: string;
  DisplayID?: string;
  UserPhone: string;
  UserPhoneMasked?: string;
  ProviderID: string;
  ProviderName?: string;
  LastMessagePreview: string;
  LastMessageAt: string;
  CreatedAt?: string;
  ThreadStatus: string;
  ModerationReason?: string;
  LastMessageBy?: string;
};

type FilterValue = "" | "active" | "flagged" | "muted" | "locked" | "closed";

function getAdminActor() {
  const session = getAuthSession();
  return {
    AdminActorPhone: String(session?.phone || "").replace(/\D/g, "").slice(-10),
  };
}

function formatDisplayDate(value: string) {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toLocaleString();
  }
  return value;
}

export default function AdminChatsPage() {
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<FilterValue>("");
  const [actionKey, setActionKey] = useState("");

  const loadThreads = async (statusFilter: FilterValue) => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_list_chat_threads",
          Status: statusFilter || "",
        }),
      });
      const data = await res.json();

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Unable to load chat threads.");
      }

      setThreads(Array.isArray(data?.threads) ? data.threads : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to load chat threads.");
      setThreads([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadThreads(filter);
  }, [filter]);

  const handleCloseChat = async (threadId: string) => {
    if (!threadId) return;

    const currentActionKey = `close:${threadId}`;
    setActionKey(currentActionKey);
    setError("");

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_update_chat_thread_status",
          ThreadID: threadId,
          ThreadStatus: "closed",
          Reason: "Closed by admin",
          ...getAdminActor(),
        }),
      });
      const data = await res.json();

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Unable to close chat.");
      }

      await loadThreads(filter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to close chat.");
    } finally {
      setActionKey("");
    }
  };

  const filterButtons = useMemo(
      () => [
        { label: "All", value: "" as FilterValue },
        { label: "Active", value: "active" as FilterValue },
        { label: "Flagged", value: "flagged" as FilterValue },
        { label: "Muted", value: "muted" as FilterValue },
        { label: "Locked", value: "locked" as FilterValue },
        { label: "Closed", value: "closed" as FilterValue },
      ],
      []
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Admin Chats</h1>
        <p className="text-sm text-slate-600">Monitor active, closed, and flagged chat threads.</p>
      </div>

      <div className="flex gap-2">
        {filterButtons.map((item) => (
          <button
            key={item.label}
            type="button"
            onClick={() => setFilter(item.value)}
            className={`rounded-lg px-3 py-2 text-sm font-semibold ${
              filter === item.value
                ? "bg-slate-900 text-white"
                : "bg-white text-slate-700 border border-slate-300"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        {loading ? (
          <p className="text-sm text-slate-600">Loading chats...</p>
        ) : error ? (
          <p className="text-sm text-rose-600">{error}</p>
        ) : threads.length === 0 ? (
          <p className="text-sm text-slate-600">No chat threads found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-slate-700">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 pr-4 font-semibold">ThreadID</th>
                  <th className="py-2 pr-4 font-semibold">Kaam</th>
                  <th className="py-2 pr-4 font-semibold">UserPhone</th>
                  <th className="py-2 pr-4 font-semibold">Provider</th>
                  <th className="py-2 pr-4 font-semibold">LastMessage</th>
                  <th className="py-2 pr-4 font-semibold">LastMessageAt</th>
                  <th className="py-2 pr-4 font-semibold">Status</th>
                  <th className="py-2 pr-4 font-semibold">ModerationReason</th>
                  <th className="py-2 pr-4 font-semibold">LastSenderType</th>
                  <th className="py-2 pr-4 font-semibold">Action</th>
                </tr>
              </thead>
              <tbody>
                {threads.map((thread) => {
                  const isBlocked = String(thread.ThreadStatus || "").trim().toLowerCase() === "flagged";
                  const isClosed = String(thread.ThreadStatus || "").trim().toLowerCase() === "closed";
                  const currentActionKey = `close:${thread.ThreadID}`;

                  return (
                    <tr
                      key={thread.ThreadID}
                      className={`border-b border-slate-100 ${isBlocked ? "bg-rose-50" : ""}`}
                    >
                      <td className="py-2 pr-4">
                        <Link
                          href={`/admin/chats/${encodeURIComponent(thread.ThreadID)}`}
                          className="font-semibold text-sky-700 underline-offset-2 hover:underline"
                        >
                          {thread.ThreadID}
                        </Link>
                      </td>
                      <td className="py-2 pr-4">
                        {getTaskDisplayLabel(thread, thread.TaskID)}
                      </td>
                      <td className="py-2 pr-4">{thread.UserPhoneMasked || "-"}</td>
                      <td className="py-2 pr-4">{thread.ProviderName || thread.ProviderID || "-"}</td>
                      <td className="py-2 pr-4">{thread.LastMessagePreview || "-"}</td>
                      <td className="py-2 pr-4">{formatDisplayDate(thread.LastMessageAt)}</td>
                      <td className="py-2 pr-4">{thread.ThreadStatus || "-"}</td>
                      <td className="py-2 pr-4">{thread.ModerationReason || "-"}</td>
                      <td className="py-2 pr-4">{thread.LastMessageBy || "-"}</td>
                      <td className="py-2 pr-4">
                        {!isClosed ? (
                          <button
                            type="button"
                            onClick={() => void handleCloseChat(thread.ThreadID)}
                            disabled={actionKey === currentActionKey}
                            className="rounded bg-slate-900 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                          >
                            {actionKey === currentActionKey ? "Closing..." : "Close Chat"}
                          </button>
                        ) : (
                          <span className="text-xs text-slate-500">Closed</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
