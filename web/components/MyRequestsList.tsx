"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import InAppToastStack, { type InAppToast } from "@/components/InAppToastStack";
import { getAuthSession } from "@/lib/auth";
import { getVerifiedLabel, isProviderVerifiedBadge, normalizeVerifiedValue } from "@/lib/providerPresentation";
import { getTaskDisplayLabel } from "@/lib/taskDisplay";
import { getTaskStatusLabel } from "@/lib/taskStatus";

type MatchedProviderRow = {
  providerId: string;
  providerName: string;
  providerPhone: string;
  verified: "yes" | "no";
  responseStatus: string;
};

type RequestRow = {
  taskId: string;
  displayId?: string;
  displayLabel: string;
  category: string;
  area: string;
  details: string;
  status: string;
  createdAt: string;
  matchedProviders: string[];
  matchedProviderDetails: MatchedProviderRow[];
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
type ThreadSummaryByTaskId = Record<
  string,
  {
    unreadUserCount: number;
    lastMessageAt: string;
    providerCount: number;
  }
>;

type CreateThreadResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  ThreadID?: string;
  threadId?: string;
  thread?: {
    ThreadID?: string;
    threadId?: string;
  };
};

function normalizeMatchedProvider(item: unknown): MatchedProviderRow | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const providerId = String(record.ProviderID ?? record.providerId ?? "").trim();
  const providerName = String(record.ProviderName ?? record.providerName ?? "").trim();
  const providerPhone = String(record.ProviderPhone ?? record.providerPhone ?? "").trim();
  const responseStatus = String(record.ResponseStatus ?? record.status ?? "").trim();

  if (!providerId) return null;

  return {
    providerId,
    providerName,
    providerPhone,
    verified: isProviderVerifiedBadge(record) ? "yes" : "no",
    responseStatus,
  };
}

const normalizeRequest = (item: RawRequest): RequestRow => ({
  taskId: String(item.TaskID ?? item.taskId ?? item.id ?? item.task_id ?? "") || "-",
  displayId: String(item.DisplayID ?? item.displayId ?? "") || "",
  displayLabel: getTaskDisplayLabel(
    {
      TaskID: item.TaskID ?? item.taskId ?? item.id ?? item.task_id ?? "",
      DisplayID: item.DisplayID ?? item.displayId ?? "",
    },
    String(item.TaskID ?? item.taskId ?? item.id ?? item.task_id ?? "")
  ),
  category: String(item.Category ?? item.category ?? "") || "-",
  area: String(item.Area ?? item.area ?? "") || "-",
  details: String(item.Details ?? item.details ?? "") || "-",
  status: String(item.Status ?? item.status ?? "") || "-",
  createdAt: String(item.CreatedAt ?? item.createdAt ?? "") || "-",
  matchedProviders: Array.isArray(item.MatchedProviders)
    ? item.MatchedProviders.map((providerId) => String(providerId || "").trim()).filter(Boolean)
    : [],
  matchedProviderDetails: Array.isArray(item.MatchedProviderDetails)
    ? item.MatchedProviderDetails.map((provider) => normalizeMatchedProvider(provider)).filter(
        (provider): provider is MatchedProviderRow => Boolean(provider)
      )
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

function extractThreadIdFromCreateThreadResponse(data: CreateThreadResponse | null): string {
  return String(
    data?.thread?.ThreadID ||
      data?.thread?.threadId ||
      data?.ThreadID ||
      data?.threadId ||
      ""
  ).trim();
}

function summarizeUserThreads(threads: ThreadRow[]): ThreadSummaryByTaskId {
  return threads.reduce<ThreadSummaryByTaskId>((acc, thread) => {
    const taskId = String(thread.TaskID || "").trim();
    if (!taskId) return acc;

    const current = acc[taskId] || {
      unreadUserCount: 0,
      lastMessageAt: "",
      providerCount: 0,
    };
    const candidateTime = String(thread.LastMessageAt || thread.UpdatedAt || thread.CreatedAt || "").trim();
    const currentTime = String(current.lastMessageAt || "").trim();

    acc[taskId] = {
      unreadUserCount: current.unreadUserCount + (Number(thread.UnreadUserCount) || 0),
      lastMessageAt:
        Date.parse(candidateTime || "") > Date.parse(currentTime || "") ? candidateTime : currentTime,
      providerCount: current.providerCount + 1,
    };

    return acc;
  }, {});
}

function buildToastId(prefix: string, taskId: string, suffix: string): string {
  return `${prefix}:${taskId}:${suffix}`;
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
  const [threadSummaryByTaskId, setThreadSummaryByTaskId] = useState<ThreadSummaryByTaskId>({});
  const [toasts, setToasts] = useState<InAppToast[]>([]);
  const previousRequestSnapshotRef = useRef<Record<string, string> | null>(null);
  const previousThreadSnapshotRef = useRef<ThreadSummaryByTaskId | null>(null);

  const enqueueToast = (title: string, message: string, id: string) => {
    setToasts((current) => {
      if (current.some((toast) => toast.id === id)) return current;
      return [...current, { id, title, message }].slice(-4);
    });

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5000);
  };

  useEffect(() => {
    const session = getAuthSession();
    if (!session?.phone) {
      setHasSession(false);
      setLoading(false);
      return;
    }

    setHasSession(true);
    const normalizedPhone = String(session.phone || "").replace(/\D/g, "").slice(-10);
    setUserPhone(normalizedPhone);

    let ignore = false;

    const loadRequests = async (showAlerts: boolean) => {
      try {
        const [res, threadRes] = await Promise.all([
          fetch("/api/my-requests", { cache: "no-store" }),
          fetch("/api/kk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "chat_get_threads",
              ActorType: "user",
              UserPhone: normalizedPhone,
            }),
          }),
        ]);
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
        const normalizedRows: RequestRow[] = list.map((item: RawRequest) => normalizeRequest(item));
        const displayLabelByTaskId = normalizedRows.reduce((acc: Record<string, string>, row) => {
          acc[row.taskId] = row.displayLabel;
          return acc;
        }, {});
        const requestSnapshot = normalizedRows.reduce((acc: Record<string, string>, row: RequestRow) => {
          acc[row.taskId] = row.respondedProvider;
          return acc;
        }, {});

        const threadData = await threadRes.json();
        if (!threadRes.ok || !threadData?.ok) {
          throw new Error(threadData?.error || "Failed to load chats");
        }

        const normalizedThreads = Array.isArray(threadData?.threads)
          ? threadData.threads.map((item: Record<string, unknown>) => normalizeThread(item))
          : [];
        const nextThreadSummary = summarizeUserThreads(normalizedThreads);

        if (!ignore) {
          setRows(normalizedRows);
          setThreadSummaryByTaskId(nextThreadSummary);
        }

        if (showAlerts && previousRequestSnapshotRef.current) {
          for (const row of normalizedRows) {
            const previousRespondedProvider = previousRequestSnapshotRef.current[row.taskId] || "";
            if (!previousRespondedProvider && row.respondedProvider) {
              enqueueToast(
                "A provider responded to your request",
                `${row.displayLabel} now has a provider response.`,
                buildToastId("response", row.taskId, row.respondedProvider)
              );
            }
          }
        }

        if (showAlerts && previousThreadSnapshotRef.current) {
          for (const [taskId, summary] of Object.entries(nextThreadSummary)) {
            const previousSummary = previousThreadSnapshotRef.current[taskId];
            if (!previousSummary) continue;
            if (summary.unreadUserCount > previousSummary.unreadUserCount && summary.lastMessageAt) {
              enqueueToast(
                "New message from provider",
                `You have ${summary.unreadUserCount} unread message${summary.unreadUserCount === 1 ? "" : "s"} on ${displayLabelByTaskId[taskId] || getTaskDisplayLabel({ TaskID: taskId }, taskId)}.`,
                buildToastId("message", taskId, `${summary.unreadUserCount}:${summary.lastMessageAt}`)
              );
            }
          }
        }

        previousRequestSnapshotRef.current = requestSnapshot;
        previousThreadSnapshotRef.current = nextThreadSummary;
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Failed to load requests");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void loadRequests(false);

    const intervalId = window.setInterval(() => {
      void loadRequests(true);
    }, 18000);

    return () => {
      ignore = true;
      window.clearInterval(intervalId);
    };
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

  const handleOpenChat = async (row: RequestRow, providerId: string, thread: ThreadRow | null) => {
    const taskId = String(row.taskId || "").trim();
    const selectedProviderId = String(providerId || "").trim();

    console.log("[my-requests] selected request item shape", {
      row,
      taskId,
      keys: Object.keys(row || {}),
    });
    console.log("[my-requests] selected provider info", {
      providerId: selectedProviderId,
      existingThread: thread,
    });

    if (!userPhone || !taskId || !selectedProviderId) {
      setThreadsErrorByTaskId((current) => ({
        ...current,
        [taskId || row.taskId || "unknown"]: "Chat unavailable: missing task or provider context.",
      }));
      return;
    }

    const chatKey = `${taskId}:${selectedProviderId}`;
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
          ProviderID: selectedProviderId,
        }),
      });
      const data = (await res.json()) as CreateThreadResponse;
      const threadId = extractThreadIdFromCreateThreadResponse(data);
      const finalHref = threadId
        ? `/chat/thread/${encodeURIComponent(threadId)}?actor=user`
        : "";

      console.log("[my-requests] open chat raw response", {
        status: res.status,
        ok: res.ok,
        data,
      });
      console.log("[my-requests] open chat selection", {
        taskId,
        providerId: selectedProviderId,
        extractedThreadId: threadId,
        finalHref,
      });

      if (!res.ok || !data?.ok || !threadId || !finalHref) {
        throw new Error(data?.error || data?.message || "Failed to open chat");
      }

      router.push(finalHref);
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
          <h1 className="text-2xl font-semibold text-slate-900">Responses</h1>
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
              const taskThreadSummary = threadSummaryByTaskId[row.taskId];
              const threadByProviderId = new Map(
                taskThreads.map((thread) => [String(thread.ProviderID || "").trim(), thread])
              );
              const matchedProviderRowsRaw =
                row.matchedProviderDetails.length > 0
                  ? row.matchedProviderDetails
                  : row.matchedProviders.map((providerId) => ({
                      providerId,
                      providerName:
                        providerId === row.respondedProvider && row.respondedProviderName
                          ? row.respondedProviderName
                          : providerId,
                      providerPhone: "",
                      verified: "no" as const,
                      responseStatus:
                        providerId === row.respondedProvider ? "responded" : "",
                    }));
              // Phone-Verified providers float to the top; relative order
              // within each group is preserved (Array.prototype.sort is
              // stable since ES2019). Indexes are captured up-front so the
              // comparator is a pure function of (verifiedRank, originalIdx)
              // — defensive in case any older runtime regresses to an
              // unstable sort.
              const matchedProviderRows = matchedProviderRowsRaw
                .map((provider, originalIndex) => ({
                  provider,
                  originalIndex,
                  verifiedRank: provider.verified === "yes" ? 0 : 1,
                }))
                .sort((a, b) =>
                  a.verifiedRank !== b.verifiedRank
                    ? a.verifiedRank - b.verifiedRank
                    : a.originalIndex - b.originalIndex
                )
                .map((entry) => entry.provider);

              return (
                <div
                  key={`${row.taskId}-${row.createdAt}-${row.area}`}
                  className="rounded-xl border border-slate-200 p-4"
                >
                  <div className="space-y-2 text-sm">
                    <p className="flex flex-wrap items-center gap-2 text-slate-900">
                      <span>
                        <span className="font-semibold">Kaam:</span> {row.displayLabel}
                      </span>
                      {taskThreadSummary?.unreadUserCount ? (
                        <span className="inline-flex rounded-full bg-rose-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                          {taskThreadSummary.unreadUserCount} unread
                        </span>
                      ) : null}
                      {row.respondedProvider ? (
                        <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
                          Provider responded
                        </span>
                      ) : null}
                    </p>
                    <p className="text-slate-900"><span className="font-semibold">Category:</span> {row.category}</p>
                    <p className="text-slate-700"><span className="font-semibold">Area:</span> {row.area}</p>
                    <p className="text-slate-700"><span className="font-semibold">Details:</span> {row.details}</p>
                    <p className="text-slate-700">
                      <span className="font-semibold">Status:</span>{" "}
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                        {getTaskStatusLabel(row.status)}
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
                    className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-sky-700"
                  >
                    {taskThreadSummary?.unreadUserCount ? (
                      <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-sky-600 px-1.5 text-[11px] text-white">
                        {taskThreadSummary.unreadUserCount}
                      </span>
                    ) : null}
                    {isExpanded ? "View Responses ▲" : "View Responses ▼"}
                  </button>

                  {isExpanded ? (
                    <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                      {isResponsesLoading ? (
                        <p className="text-sm text-slate-600">Loading responses...</p>
                      ) : responsesError ? (
                        <p className="text-sm text-rose-600">{responsesError}</p>
                      ) : matchedProviderRows.length === 0 ? (
                        <p className="text-sm text-slate-600">No matched providers yet.</p>
                      ) : (
                        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                          <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
                            <thead className="bg-slate-100 text-slate-700">
                              <tr>
                                <th className="px-3 py-3 font-semibold">Provider Name</th>
                                <th className="px-3 py-3 font-semibold">Phone</th>
                                <th className="px-3 py-3 font-semibold">Phone Verified</th>
                                <th className="px-3 py-3 font-semibold">Response Status</th>
                                <th className="px-3 py-3 font-semibold">Chat / Action</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200 text-slate-800">
                              {matchedProviderRows.map((provider) => {
                                const providerId = String(provider.providerId || "").trim();
                                const thread = threadByProviderId.get(providerId) || null;
                                const chatKey = `${row.taskId}:${providerId}`;
                                const responseStatus =
                                  providerId === row.respondedProvider
                                    ? "Responded"
                                    : provider.responseStatus
                                      ? provider.responseStatus
                                          .replace(/_/g, " ")
                                          .replace(/\b\w/g, (ch) => ch.toUpperCase())
                                      : "Awaiting response";

                                return (
                                  <tr key={providerId}>
                                    <td className="px-3 py-3 align-top">
                                      <div className="font-medium text-slate-900">
                                        {provider.providerName || providerId}
                                      </div>
                                    </td>
                                    <td className="px-3 py-3 align-top">
                                      {provider.providerPhone ? (
                                        <a
                                          href={`tel:${provider.providerPhone}`}
                                          className="text-blue-600 hover:underline"
                                        >
                                          {provider.providerPhone}
                                        </a>
                                      ) : (
                                        <span className="text-slate-500">-</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-3 align-top">
                                      <span
                                        className={
                                          provider.verified === "yes"
                                            ? "inline-flex rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700"
                                            : "inline-flex rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700"
                                        }
                                      >
                                        {getVerifiedLabel(provider.verified)}
                                      </span>
                                    </td>
                                    <td className="px-3 py-3 align-top">
                                      <div>{responseStatus}</div>
                                      <div className="text-xs text-slate-500">
                                        {thread?.ThreadID || "Thread not created yet"}
                                      </div>
                                      {thread?.LastMessageAt || thread?.UpdatedAt || thread?.CreatedAt ? (
                                        <div className="text-xs text-slate-500">
                                          Last activity:{" "}
                                          {formatDisplayDate(
                                            thread?.LastMessageAt || thread?.UpdatedAt || thread?.CreatedAt || ""
                                          )}
                                        </div>
                                      ) : null}
                                    </td>
                                    <td className="px-3 py-3 align-top">
                                      <button
                                        type="button"
                                        onClick={() => void handleOpenChat(row, providerId, thread)}
                                        disabled={openingChatKey === chatKey || !row.taskId || !providerId}
                                        className="inline-flex rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-60"
                                      >
                                        {openingChatKey === chatKey ? "Opening..." : "Open Chat"}
                                      </button>
                                      {thread?.UnreadUserCount ? (
                                        <div className="mt-2 inline-flex rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-semibold text-rose-700">
                                          {thread.UnreadUserCount} unread
                                        </div>
                                      ) : null}
                                      {!row.taskId || !providerId ? (
                                        <p className="mt-2 text-xs text-rose-600">
                                          Chat unavailable: missing task or provider identifier.
                                        </p>
                                      ) : null}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
      <InAppToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />
    </main>
  );
}
