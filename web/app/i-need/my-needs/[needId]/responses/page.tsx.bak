"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { getAuthSession } from "@/lib/auth";

type ThreadStatus = "open" | "completed" | "closed";

type ResponseThread = {
  threadId: string;
  responderLabel: string;
  lastMessage: string;
  lastActivityTime: string;
  unreadCount: number;
  status: ThreadStatus;
};

type BackendThread = {
  ThreadID?: string;
  ResponderPhone?: string;
  Status?: string;
  LastMessageAt?: string;
  LastMessageBy?: string;
  UnreadPosterCount?: number;
};

type ThreadsResponse = {
  ok?: boolean;
  threads?: BackendThread[];
  error?: string;
  message?: string;
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

function maskResponderPhone(phone: string): string {
  const digits = normalizePhoneToTen(phone);
  if (!digits) return "Unknown responder";
  return `${digits.slice(0, 5)}•••${digits.slice(-2)}`;
}

function toThreadStatus(value: string): ThreadStatus {
  const normalized = value.trim().toLowerCase();
  if (normalized === "completed") return "completed";
  if (normalized === "closed") return "closed";
  return "open";
}

const STATUS_CONFIG: Record<ThreadStatus, { label: string; classes: string }> = {
  open: {
    label: "Active",
    classes: "border-emerald-100 bg-emerald-50 text-emerald-700",
  },
  completed: {
    label: "Completed",
    classes: "border-sky-100 bg-sky-50 text-sky-700",
  },
  closed: {
    label: "Closed",
    classes: "border-slate-200 bg-slate-100 text-slate-500",
  },
};

function SummaryStrip({
  threads,
}: {
  threads: ResponseThread[];
}) {
  const total = threads.length;
  const unread = threads.filter((t) => t.unreadCount > 0).length;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">
        {total} {total === 1 ? "response" : "responses"}
      </span>
      {unread > 0 && (
        <span className="inline-flex items-center gap-1 rounded-full border border-[#003d20]/15 bg-[#003d20]/5 px-3 py-1 text-xs font-semibold text-[#003d20]">
          <span className="h-1.5 w-1.5 rounded-full bg-[#003d20]" />
          {unread} unread
        </span>
      )}
    </div>
  );
}

function ThreadCard({
  thread,
}: {
  thread: ResponseThread;
}) {
  const cfg = STATUS_CONFIG[thread.status];

  return (
    <Link
      href={`/i-need/chat/${encodeURIComponent(thread.threadId)}?role=poster`}
      className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#003d20]/10 text-xs font-bold text-[#003d20]">
              {thread.responderLabel.charAt(0)}
            </div>
            <span className="truncate text-sm font-semibold text-slate-800">
              {thread.responderLabel}
            </span>
            {thread.unreadCount > 0 && (
              <span className="ml-auto shrink-0 rounded-full bg-orange-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                {thread.unreadCount}
              </span>
            )}
          </div>
          <p className="mt-2 truncate text-xs leading-relaxed text-slate-500">
            {thread.lastMessage}
          </p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="text-[10px] text-slate-400">{thread.lastActivityTime}</span>
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cfg.classes}`}
          >
            {cfg.label}
          </span>
        </div>
      </div>

      <div className="mt-3 flex justify-end border-t border-slate-100 pt-3">
        <span className="text-xs font-semibold text-[#003d20] hover:text-[#003d20]/80">
          Open Conversation →
        </span>
      </div>
    </Link>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-14 text-center">
      <div className="text-4xl">📭</div>
      <h3 className="mt-3 text-base font-semibold text-slate-800">No responses yet</h3>
      <p className="mt-1 max-w-xs text-sm text-slate-500">
        No one has responded to this need yet. Check back later or consider reposting
        with more details.
      </p>
      <Link
        href="/i-need/my-needs"
        className="mt-5 inline-flex rounded-xl border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
      >
        Back to My Requests
      </Link>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center rounded-2xl border border-slate-200 bg-white px-6 py-14 text-center shadow-sm">
      <div>
        <svg className="mx-auto h-6 w-6 animate-spin text-[#003d20]" fill="none" viewBox="0 0 24 24">
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
        <p className="mt-3 text-sm text-slate-500">Loading responses...</p>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-2xl border border-rose-100 bg-rose-50 px-5 py-5 text-sm text-rose-700">
      {message}
    </div>
  );
}

export default function NeedResponsesPage() {
  const params = useParams();
  const router = useRouter();
  const needId = String(params?.needId ?? "").trim();

  const [threads, setThreads] = useState<ResponseThread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    let isActive = true;

    async function loadThreads() {
      if (!needId) {
        if (isActive) {
          setLoadError("Need not found.");
          setIsLoading(false);
        }
        return;
      }

      const userPhone = getUserPhone();
      if (!userPhone) {
        const nextPath = `/i-need/my-needs/${encodeURIComponent(needId)}/responses`;
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
        return;
      }

      if (isActive) {
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
            action: "need_chat_get_threads_for_need",
            NeedID: needId,
            UserPhone: userPhone,
          }),
        });

        const raw = await response.text();
        let data: ThreadsResponse | null = null;

        try {
          data = JSON.parse(raw) as ThreadsResponse;
        } catch {
          data = null;
        }

        if (!response.ok || data?.ok !== true) {
          throw new Error(String(data?.error || data?.message || "Unable to load responses."));
        }

        const nextThreads = Array.isArray(data?.threads)
          ? data.threads
              .filter((thread) => String(thread.ThreadID || "").trim())
              .map((thread) => ({
                threadId: String(thread.ThreadID || "").trim(),
                responderLabel: maskResponderPhone(String(thread.ResponderPhone || "").trim()),
                lastMessage:
                  String(thread.LastMessageBy || "").trim()
                    ? `Last message by ${String(thread.LastMessageBy || "").trim()}`
                    : "No messages yet",
                lastActivityTime:
                  String(thread.LastMessageAt || "").trim() ||
                  "No recent activity",
                unreadCount: Number(thread.UnreadPosterCount) || 0,
                status: toThreadStatus(String(thread.Status || "").trim()),
              }))
          : [];

        if (!isActive) return;
        setThreads(nextThreads);
      } catch (error) {
        if (!isActive) return;
        setLoadError(error instanceof Error ? error.message : "Unable to load responses.");
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    void loadThreads();

    return () => {
      isActive = false;
    };
  }, [needId, router]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-2xl px-4 pb-16 pt-6">
        <div className="mb-6 flex items-start gap-3">
          <button
            type="button"
            onClick={() => router.back()}
            aria-label="Go back"
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:bg-slate-50"
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

          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-widest text-[#003d20]">
              My Requests
            </p>
            <h1 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900">
              Responses
            </h1>
            <p className="mt-0.5 truncate text-sm text-slate-400">
              {needId ? `Need #${needId}` : "Loading need..."}
            </p>
          </div>
        </div>

        {!isLoading && !loadError && threads.length > 0 && (
          <div className="mb-5">
            <SummaryStrip threads={threads} />
          </div>
        )}

        {isLoading ? (
          <LoadingState />
        ) : loadError ? (
          <ErrorState message={loadError} />
        ) : threads.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-3">
            {threads.map((thread) => (
              <ThreadCard key={thread.threadId} thread={thread} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
