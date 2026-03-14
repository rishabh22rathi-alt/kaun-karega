"use client";

import Link from "next/link";
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
};

type ThreadRow = {
  ThreadID: string;
  TaskID: string;
  UserPhone: string;
  ProviderID: string;
  LastMessage: string;
  LastMessageAt: string;
  UnreadUser: number;
  UnreadProvider: number;
  CreatedAt: string;
};

type RawRequest = Record<string, unknown>;

const normalizeRequest = (item: RawRequest): RequestRow => ({
  taskId:
    String(
      item.TaskID ??
        item.taskId ??
        item.id ??
        item.task_id ??
        ""
    ) || "-",
  category: String(item.Category ?? item.category ?? "") || "-",
  area: String(item.Area ?? item.area ?? "") || "-",
  details: String(item.Details ?? item.details ?? "") || "-",
  status: String(item.Status ?? item.status ?? "") || "-",
  createdAt: String(item.CreatedAt ?? item.createdAt ?? "") || "-",
});

const normalizeThread = (item: Record<string, unknown>): ThreadRow => ({
  ThreadID: String(item.ThreadID ?? item.threadId ?? "") || "",
  TaskID: String(item.TaskID ?? item.taskId ?? "") || "",
  UserPhone: String(item.UserPhone ?? item.userPhone ?? "") || "",
  ProviderID: String(item.ProviderID ?? item.providerId ?? "") || "-",
  LastMessage: String(item.LastMessage ?? item.lastMessage ?? "") || "-",
  LastMessageAt: String(item.LastMessageAt ?? item.lastMessageAt ?? "") || "",
  UnreadUser: Number(item.UnreadUser ?? item.unreadUser ?? 0) || 0,
  UnreadProvider: Number(item.UnreadProvider ?? item.unreadProvider ?? 0) || 0,
  CreatedAt: String(item.CreatedAt ?? item.createdAt ?? "") || "",
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
        const normalized = list.map((item: RawRequest) =>
          normalizeRequest(item)
        );
        setRows(normalized);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load requests"
        );
      } finally {
        setLoading(false);
      }
    };

    loadRequests();
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
          action: "get_user_task_threads",
          TaskID: taskId,
          UserPhone: userPhone,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to load responses");
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
        [taskId]: err instanceof Error ? err.message : "Failed to load responses",
      }));
    } finally {
      setThreadsLoadingByTaskId((current) => ({
        ...current,
        [taskId]: false,
      }));
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
          <h1 className="text-2xl font-semibold text-slate-900">
            My Requests
          </h1>
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
              const responseCount = taskThreads.length;

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
                      <span className="font-semibold">Responses:</span> {responseCount}
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
                      ) : taskThreads.length === 0 ? (
                        <p className="text-sm text-slate-600">No responses yet.</p>
                      ) : (
                        taskThreads.map((thread) => (
                          <div
                            key={thread.ThreadID}
                            className="rounded-lg border border-slate-200 bg-white p-3 text-sm"
                          >
                            <p className="text-slate-900">
                              <span className="font-semibold">ProviderID:</span> {thread.ProviderID}
                            </p>
                            <p className="mt-1 text-slate-700">
                              <span className="font-semibold">LastMessage:</span> {thread.LastMessage || "-"}
                            </p>
                            <p className="mt-1 text-slate-700">
                              <span className="font-semibold">LastMessageAt:</span>{" "}
                              {formatDisplayDate(thread.LastMessageAt || thread.CreatedAt)}
                            </p>
                            <p className="mt-1 text-slate-700">
                              <span className="font-semibold">UnreadUser:</span> {thread.UnreadUser}
                            </p>
                            <Link
                              href={`/dashboard/my-requests/chat/${encodeURIComponent(thread.ThreadID)}`}
                              className="mt-3 inline-flex rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                            >
                              Open Chat
                            </Link>
                          </div>
                        ))
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
