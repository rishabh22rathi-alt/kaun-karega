"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

type RequestRow = {
  taskId: string;
  category: string;
  area: string;
  details: string;
  status: string;
  createdAt: string;
  matchedProviders: string[];
  respondedProvider: string;
  respondedProviderName: string;
};

type ThreadRow = {
  ThreadID: string;
  TaskID: string;
  UserPhone: string;
  ProviderID: string;
  ProviderPhone?: string;
  Category?: string;
  Area?: string;
  Status?: string;
  CreatedAt: string;
  UpdatedAt?: string;
  LastMessageAt: string;
  LastMessageBy?: string;
  UnreadUserCount: number;
  UnreadProviderCount: number;
};

type RawRequest = Record<string, unknown>;

const normalizeRequest = (item: RawRequest): RequestRow => ({
  taskId: String(item.TaskID ?? item.taskId ?? item.id ?? item.task_id ?? "") || "-",
  category: String(item.Category ?? item.category ?? "") || "-",
  area: String(item.Area ?? item.area ?? "") || "-",
  details: String(item.Details ?? item.details ?? "") || "-",
  status: String(item.Status ?? item.status ?? "") || "-",
  createdAt: String(item.CreatedAt ?? item.createdAt ?? "") || "-",
  matchedProviders: Array.isArray(item.MatchedProviders)
    ? item.MatchedProviders.map((providerId) => String(providerId || "").trim()).filter(Boolean)
    : [],
  respondedProvider: String(item.RespondedProvider ?? item.respondedProvider ?? "") || "",
  respondedProviderName:
    String(item.RespondedProviderName ?? item.respondedProviderName ?? "") || "",
});

const normalizeThread = (item: Record<string, unknown>): ThreadRow => ({
  ThreadID: String(item.ThreadID ?? item.threadId ?? "") || "",
  TaskID: String(item.TaskID ?? item.taskId ?? "") || "",
  UserPhone: String(item.UserPhone ?? item.userPhone ?? "") || "",
  ProviderID: String(item.ProviderID ?? item.providerId ?? "") || "",
  ProviderPhone: String(item.ProviderPhone ?? item.providerPhone ?? "") || "",
  Category: String(item.Category ?? item.category ?? "") || "",
  Area: String(item.Area ?? item.area ?? "") || "",
  Status: String(item.Status ?? item.status ?? "") || "",
  CreatedAt: String(item.CreatedAt ?? item.createdAt ?? "") || "",
  UpdatedAt: String(item.UpdatedAt ?? item.updatedAt ?? "") || "",
  LastMessageAt: String(item.LastMessageAt ?? item.lastMessageAt ?? "") || "",
  LastMessageBy: String(item.LastMessageBy ?? item.lastMessageBy ?? "") || "",
  UnreadUserCount:
    Number(item.UnreadUserCount ?? item.unreadUserCount ?? item.UnreadUser ?? item.unreadUser ?? 0) || 0,
  UnreadProviderCount:
    Number(
      item.UnreadProviderCount ?? item.unreadProviderCount ?? item.UnreadProvider ?? item.unreadProvider ?? 0
    ) || 0,
});

function formatDisplayDate(value: string) {
  if (!value) return "-";
  const parsed = Date.parse(value);
  if (!Number.isNaN(parsed)) {
    return new Date(parsed).toLocaleString();
  }
  return value;
}

export default function MyRequestsList() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [error, setError] = useState("");
  const [hasSession, setHasSession] = useState(false);
  const [userPhone, setUserPhone] = useState("");
  const [expandedTaskIds, setExpandedTaskIds] = useState<Record<string, boolean>>({});
  const [threadsByTaskId, setThreadsByTaskId] = useState<Record<string, ThreadRow[]>>({});
  const [threadsLoadingByTaskId, setThreadsLoadingByTaskId] = useState<Record<string, boolean>>({});
  const [threadsErrorByTaskId, setThreadsErrorByTaskId] = useState<Record<string, string>>({});
  const [openingChatKey, setOpeningChatKey] = useState("");

  useEffect(() => {
    const session = getAuthSession();
    if (!session?.phone) {
      setHasSession(false);
      setLoading(false);
      return;
    }

    setHasSession(true);
    setUserPhone(String(session.phone || "").replace(/\D/g, "").slice(-10));

    const loadRequests = async () => {
      try {
        const res = await fetch("/api/my-requests", { cache: "no-store" });
        if (res.status === 401) {
          setHasSession(false);
          setLoading(false);
          router.replace("/login");
          return;
        }
        const data = await res.json();
        if (!res.ok || data?.ok !== true) {
          throw new Error(data?.error || "Failed to load requests");
        }

        const list = Array.isArray(data?.requests)
          ? data.requests
          : Array.isArray(data?.tasks)
            ? data.tasks
            : [];
        setRows(list.map((item: RawRequest) => normalizeRequest(item)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load requests");
      } finally {
        setLoading(false);
      }
    };

    void loadRequests();
  }, [router]);

  const total = useMemo(() => rows.length, [rows]);

  const handleToggleResponses = async (taskId: string) => {
    const isExpanded = Boolean(expandedTaskIds[taskId]);
    setExpandedTaskIds((current) => ({
      ...current,
      [taskId]: !isExpanded,
    }));

    if (isExpanded || threadsByTaskId[taskId] || !userPhone) {
      return;
    }

    setThreadsLoadingByTaskId((current) => ({
      ...current,
      [taskId]: true,
    }));
    setThreadsErrorByTaskId((current) => ({
      ...current,
      [taskId]: "",
    }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_get_threads",
          ActorType: "user",
          TaskID: taskId,
          UserPhone: userPhone,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to load chats");
      }

      const threads = Array.isArray(data?.threads)
        ? data.threads.map((item: Record<string, unknown>) => normalizeThread(item))
        : [];

      setThreadsByTaskId((current) => ({
        ...current,
        [taskId]: threads,
      }));
    } catch (err) {
      setThreadsErrorByTaskId((current) => ({
        ...current,
        [taskId]: err instanceof Error ? err.message : "Failed to load chats",
      }));
    } finally {
      setThreadsLoadingByTaskId((current) => ({
        ...current,
        [taskId]: false,
      }));
    }
  };

  const handleOpenChat = async (taskId: string, providerId: string) => {
    if (!userPhone || !providerId) return;

    const chatKey = `${taskId}:${providerId}`;
    setOpeningChatKey(chatKey);
    setThreadsErrorByTaskId((current) => ({
      ...current,
      [taskId]: "",
    }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_create_or_get_thread",
          ActorType: "user",
          UserPhone: userPhone,
          TaskID: taskId,
          ProviderID: providerId,
        }),
      });
      const data = await res.json();
      const threadId = String(data?.thread?.ThreadID || "").trim();

      if (!res.ok || !data?.ok || !threadId) {
        throw new Error(data?.error || "Failed to open chat");
      }

      router.push(`/dashboard/my-requests/chat/${encodeURIComponent(threadId)}`);
    } catch (err) {
      setThreadsErrorByTaskId((current) => ({
        ...current,
        [taskId]: err instanceof Error ? err.message : "Failed to open chat",
      }));
    } finally {
      setOpeningChatKey("");
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          Loading your requests...
        </div>
      </main>
    );
  }

  if (!hasSession) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          Please log in to view your requests.
        </div>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 text-red-600 shadow-sm">
          {error}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-slate-900">My Requests</h1>
          <p className="text-sm text-slate-600">Total requests: {total}</p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            No requests yet. Create your first task from home.
          </div>
        ) : (
          <div className="space-y-4">
            {rows.map((row) => {
              const isExpanded = Boolean(expandedTaskIds[row.taskId]);
              const taskThreads = threadsByTaskId[row.taskId] || [];
              const isResponsesLoading = Boolean(threadsLoadingByTaskId[row.taskId]);
              const responsesError = threadsErrorByTaskId[row.taskId] || "";
              const threadByProviderId = new Map(
                taskThreads.map((thread) => [String(thread.ProviderID || "").trim(), thread])
              );

              return (
                <div
                  key={`${row.taskId}-${row.createdAt}-${row.area}`}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="space-y-2 text-sm">
                    <p className="text-slate-900"><span className="font-semibold">Task ID:</span> {row.taskId}</p>
                    <p className="text-slate-900"><span className="font-semibold">Category:</span> {row.category}</p>
                    <p className="text-slate-700"><span className="font-semibold">Area:</span> {row.area}</p>
                    <p className="text-slate-700"><span className="font-semibold">Details:</span> {row.details}</p>
                    <p className="text-slate-700">
                      <span className="font-semibold">Status:</span>{" "}
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        {row.status}
                      </span>
                    </p>
                    <p className="text-slate-700">
                      <span className="font-semibold">Created:</span> {formatDisplayDate(row.createdAt)}
                    </p>
                    <p className="text-slate-700">
                      <span className="font-semibold">Matched Providers:</span> {row.matchedProviders.length}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleToggleResponses(row.taskId)}
                    className="mt-4 text-sm font-semibold text-sky-700"
                  >
                    {isExpanded ? "View Responses ▲" : "View Responses ▼"}
                  </button>

                  {isExpanded ? (
                    <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      {isResponsesLoading ? (
                        <p className="text-sm text-slate-600">Loading responses...</p>
                      ) : responsesError ? (
                        <p className="text-sm text-rose-600">{responsesError}</p>
                      ) : row.matchedProviders.length === 0 ? (
                        <p className="text-sm text-slate-600">No matched providers yet.</p>
                      ) : (
                        row.matchedProviders.map((providerId) => {
                          const thread = threadByProviderId.get(providerId) || null;
                          const chatKey = `${row.taskId}:${providerId}`;
                          const providerLabel =
                            providerId === row.respondedProvider && row.respondedProviderName
                              ? `${providerId} (${row.respondedProviderName})`
                              : providerId;

                          return (
                            <div
                              key={providerId}
                              className="rounded-lg border border-slate-200 bg-white p-3 text-sm"
                            >
                              <p className="text-slate-900">
                                <span className="font-semibold">ProviderID:</span> {providerLabel}
                              </p>
                              <p className="mt-1 text-slate-700">
                                <span className="font-semibold">Thread:</span>{" "}
                                {thread?.ThreadID || "Not created yet"}
                              </p>
                              <p className="mt-1 text-slate-700">
                                <span className="font-semibold">Last activity:</span>{" "}
                                {formatDisplayDate(
                                  thread?.LastMessageAt || thread?.UpdatedAt || thread?.CreatedAt || ""
                                )}
                              </p>
                              <p className="mt-1 text-slate-700">
                                <span className="font-semibold">Unread for user:</span>{" "}
                                {thread?.UnreadUserCount || 0}
                              </p>
                              <button
                                type="button"
                                onClick={() => void handleOpenChat(row.taskId, providerId)}
                                disabled={openingChatKey === chatKey}
                                className="mt-3 inline-flex rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                              >
                                {openingChatKey === chatKey ? "Opening..." : "Open Chat"}
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
