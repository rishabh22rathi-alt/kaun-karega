"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { getTaskDisplayLabel } from "@/lib/taskDisplay";
import InAppToastStack, { type InAppToast } from "@/components/InAppToastStack";

type MatchedRequest = {
  TaskID: string;
  DisplayID?: string;
  Category: string;
  Area: string;
  Details?: string;
  CreatedAt?: string;
  Accepted?: boolean;
  Responded?: boolean;
  ThreadID?: string;
};

type DashboardProfileResponse = {
  ok?: boolean;
  provider?: {
    ProviderID?: string;
    ProviderName?: string;
    Analytics?: {
      RecentMatchedRequests?: MatchedRequest[];
    };
  };
};

type FilterKey = "all" | "new" | "responded" | "accepted";

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New" },
  { key: "responded", label: "Responded" },
  { key: "accepted", label: "Accepted" },
];

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN");
}

function normalizePhoneToTen(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export default function ProviderJobRequestsPage() {
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [providerId, setProviderId] = useState("");
  const [requests, setRequests] = useState<MatchedRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [openingChatTaskId, setOpeningChatTaskId] = useState("");
  const [chatErrorByTaskId, setChatErrorByTaskId] = useState<Record<string, string>>({});
  const [toasts, setToasts] = useState<InAppToast[]>([]);

  const showSuccessToast = (message: string) => {
    const id = `job-toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setToasts((current) => [...current, { id, title: "Responded", message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 2500);
  };

  const dismissToast = (id: string) => {
    setToasts((current) => current.filter((t) => t.id !== id));
  };

  useEffect(() => {
    const session = getAuthSession();
    const userPhone = normalizePhoneToTen(session?.phone || "");
    if (!/^\d{10}$/.test(userPhone)) {
      router.replace("/login?next=/provider/job-requests");
      return;
    }
    setPhone(userPhone);
  }, [router]);

  useEffect(() => {
    if (!phone) return;
    let ignore = false;

    const load = async () => {
      try {
        const res = await fetch("/api/provider/dashboard-profile", { cache: "no-store" });
        const data = (await res.json()) as DashboardProfileResponse;
        if (ignore) return;
        if (!res.ok || !data?.ok) {
          setError("Unable to load job requests.");
          setRequests([]);
          return;
        }
        setProviderId(String(data.provider?.ProviderID || ""));
        const list = data.provider?.Analytics?.RecentMatchedRequests;
        setRequests(Array.isArray(list) ? list : []);
      } catch {
        if (!ignore) {
          setError("Network error while loading job requests.");
          setRequests([]);
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void load();
    return () => {
      ignore = true;
    };
  }, [phone]);

  const filtered = useMemo(() => {
    if (filter === "new") return requests.filter((r) => !r.Responded);
    if (filter === "responded") return requests.filter((r) => r.Responded);
    if (filter === "accepted") return requests.filter((r) => r.Accepted);
    return requests;
  }, [filter, requests]);

  const counts = useMemo(
    () => ({
      all: requests.length,
      new: requests.filter((r) => !r.Responded).length,
      responded: requests.filter((r) => r.Responded).length,
      accepted: requests.filter((r) => r.Accepted).length,
    }),
    [requests]
  );

  const openChatForTask = async (request: MatchedRequest) => {
    const taskId = String(request.TaskID || "").trim();
    const missingKey = `missing-${request.CreatedAt || request.Category || "unknown"}`;
    if (!taskId) {
      setChatErrorByTaskId((current) => ({
        ...current,
        [missingKey]: "Chat unavailable: missing task ID for this request.",
      }));
      return;
    }
    if (!phone) {
      setChatErrorByTaskId((current) => ({
        ...current,
        [taskId]: "Chat unavailable: provider session missing.",
      }));
      return;
    }

    setOpeningChatTaskId(taskId);
    setChatErrorByTaskId((current) => ({ ...current, [taskId]: "" }));

    // Implicit respond: if not already responded and we have a providerId,
    // mark this task as responded before opening the chat. Failures here are
    // non-blocking — the user's primary intent is to chat.
    if (!request.Responded && providerId) {
      try {
        const respondRes = await fetch("/api/tasks/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, providerId }),
        });
        const respondData = (await respondRes.json()) as { success?: boolean };
        if (respondRes.ok && respondData?.success) {
          setRequests((prev) =>
            prev.map((r) =>
              String(r.TaskID || "").trim() === taskId ? { ...r, Responded: true } : r
            )
          );
          showSuccessToast("You’ve responded to this request");
        }
      } catch {
        // Non-blocking — proceed to open chat.
      }
    }

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_create_or_get_thread",
          ActorType: "provider",
          TaskID: taskId,
          loggedInProviderPhone: phone,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        ThreadID?: string;
        threadId?: string;
        thread?: { ThreadID?: string };
        error?: string;
      };
      const threadId =
        String(data?.ThreadID || data?.threadId || data?.thread?.ThreadID || "").trim();
      if (!res.ok || !data?.ok || !threadId) {
        setChatErrorByTaskId((current) => ({
          ...current,
          [taskId]: data?.error || "Unable to open chat right now. Please try again.",
        }));
        return;
      }
      router.push(`/chat/thread/${encodeURIComponent(threadId)}`);
    } catch {
      setChatErrorByTaskId((current) => ({
        ...current,
        [taskId]: "Network error while opening chat.",
      }));
    } finally {
      setOpeningChatTaskId("");
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto w-full max-w-4xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Loading job requests...</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)] px-4 py-8">
      <div className="mx-auto w-full max-w-4xl space-y-6">
        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Job Requests</h1>
          <p className="mt-1 text-sm text-slate-600">
            Matched customer requests for your services and areas.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            {FILTER_OPTIONS.map((opt) => {
              const active = filter === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setFilter(opt.key)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition ${
                    active
                      ? "border-sky-300 bg-sky-100 text-sky-800"
                      : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <span>{opt.label}</span>
                  <span
                    className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] ${
                      active ? "bg-sky-600 text-white" : "bg-slate-200 text-slate-700"
                    }`}
                  >
                    {counts[opt.key]}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 py-10 text-center text-sm text-slate-500">
            {requests.length === 0
              ? "No matched requests yet. As demand rises in your services and areas, leads will show up here."
              : "No requests match this filter."}
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((request) => {
              const taskId = String(request.TaskID || "").trim();
              const taskKey = taskId || `missing-${request.CreatedAt || request.Category || "unknown"}`;
              const chatError = chatErrorByTaskId[taskKey] || chatErrorByTaskId[taskId];
              const isOpening = openingChatTaskId === taskId;
              return (
                <article
                  key={taskKey}
                  className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
                >
                  <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                    <div className="space-y-1.5">
                      <p className="text-sm font-semibold text-slate-900">
                        {getTaskDisplayLabel(request, taskId)}
                      </p>
                      <p className="text-sm text-slate-700">
                        {request.Category || "-"} in {request.Area || "-"}
                      </p>
                      <p className="text-xs text-slate-500">
                        Posted: {formatDateTime(request.CreatedAt || "")}
                      </p>
                      {request.Details ? (
                        <p className="pt-1 text-sm text-slate-600">{request.Details}</p>
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-start gap-2">
                      <span
                        className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${
                          request.Responded
                            ? "border-green-200 bg-green-100 text-green-800"
                            : "border-slate-200 bg-slate-100 text-slate-700"
                        }`}
                      >
                        {request.Responded ? "Responded" : "New"}
                      </span>
                      {request.Accepted ? (
                        <span className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                          Accepted
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void openChatForTask(request)}
                      disabled={!taskId || isOpening}
                      className="inline-flex items-center justify-center rounded-xl bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isOpening ? "Opening..." : "Chat"}
                    </button>
                  </div>

                  {chatError ? (
                    <p className="mt-3 text-xs text-rose-700">{chatError}</p>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}

        <div className="pt-2 text-center text-xs text-slate-500">
          <Link href="/provider/dashboard" className="font-semibold text-sky-600 hover:text-sky-700">
            &larr; Back to Provider Dashboard
          </Link>
        </div>
      </div>
      <InAppToastStack toasts={toasts} onDismiss={dismissToast} />
    </main>
  );
}
