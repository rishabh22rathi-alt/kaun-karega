"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, X as CloseIcon } from "lucide-react";
import UnreadBadge, { type UnreadIndicator } from "./UnreadBadge";

// Admin "Chats" accordion for /admin/dashboard.
//
// Reads (no mutations):
//   GET /api/admin/chats             — unioned task + i-need threads
//   GET /api/admin/chats/[threadId]  — single thread + messages
//
// This tab is intentionally monitor-only — no admin reply box, no
// status mutation surface. The existing /admin/chats moderation page
// owns close-thread/flag actions and is unaffected.
//
// Data shape mirrors lib/admin/adminChats.ts. We don't share types
// across the boundary (would require either a shared package or
// duplicating the import path); instead, mirror the few fields the
// UI consumes here so a backend rename has to consciously touch both
// layers.

type ChatType = "task" | "need";
type ChatTypeFilter = "all" | ChatType;
type ChatStatusFilter = "" | "active" | "closed" | "flagged" | "muted" | "locked";

type ThreadSummary = {
  threadId: string;
  type: ChatType;
  taskOrNeedId: string;
  displayId: string | null;
  userPhone: string;
  providerId: string | null;
  providerName: string | null;
  providerPhone: string | null;
  category: string | null;
  area: string | null;
  status: string;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  lastMessageBy: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

type SummaryStats = {
  total: number;
  active: number;
  closed: number;
  task: number;
  need: number;
};

type ListResponse = {
  ok?: boolean;
  threads?: ThreadSummary[];
  stats?: SummaryStats;
  error?: string;
};

type ChatMessage = {
  messageId: string;
  threadId: string;
  sender: "user" | "provider" | "system";
  rawSender: string;
  senderPhone: string | null;
  senderName: string | null;
  text: string;
  createdAt: string | null;
};

type DetailResponse = {
  ok?: boolean;
  thread?: ThreadSummary;
  messages?: ChatMessage[];
  error?: string;
};

type ChatsTabProps = {
  defaultOpen?: boolean;
  // See IssueReportsTab for the unread+onMarkRead contract.
  unread?: UnreadIndicator | null;
  onMarkRead?: () => void;
};

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  active: "border-emerald-300 bg-emerald-100 text-emerald-800",
  closed: "border-slate-300 bg-slate-100 text-slate-700",
  flagged: "border-rose-300 bg-rose-100 text-rose-800",
  muted: "border-amber-300 bg-amber-100 text-amber-800",
  locked: "border-orange-300 bg-orange-100 text-orange-800",
};

function statusBadgeClass(status: string): string {
  return (
    STATUS_BADGE_CLASS[status] ||
    "border-slate-300 bg-slate-100 text-slate-700"
  );
}

const TYPE_LABEL: Record<ChatType, string> = {
  task: "Task Chat",
  need: "I-Need Chat",
};

const TYPE_BADGE_CLASS: Record<ChatType, string> = {
  task: "border-[#003d20]/30 bg-emerald-50 text-[#003d20]",
  need: "border-indigo-300 bg-indigo-50 text-indigo-700",
};

const SENDER_BADGE_CLASS: Record<ChatMessage["sender"], string> = {
  user: "border-blue-300 bg-blue-50 text-blue-800",
  provider: "border-emerald-300 bg-emerald-50 text-emerald-800",
  system: "border-slate-300 bg-slate-100 text-slate-700",
};

const SENDER_LABEL: Record<ChatMessage["sender"], string> = {
  user: "User",
  provider: "Provider",
  system: "System / Admin",
};

export default function ChatsTab({
  defaultOpen = false,
  unread,
  onMarkRead,
}: ChatsTabProps = {}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const markReadFiredRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      markReadFiredRef.current = false;
      return;
    }
    if (markReadFiredRef.current) return;
    markReadFiredRef.current = true;
    onMarkRead?.();
  }, [isOpen, onMarkRead]);
  const [threads, setThreads] = useState<ThreadSummary[] | null>(null);
  const [stats, setStats] = useState<SummaryStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Filters
  const [typeFilter, setTypeFilter] = useState<ChatTypeFilter>("all");
  const [statusFilter, setStatusFilter] =
    useState<ChatStatusFilter>("");
  const [search, setSearch] = useState("");

  // Detail drawer
  const [activeThread, setActiveThread] = useState<ThreadSummary | null>(
    null
  );
  const [detailMessages, setDetailMessages] = useState<ChatMessage[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (defaultOpen) setIsOpen(true);
  }, [defaultOpen]);

  // Re-fetch when the accordion opens, when filters change, or when
  // the user hits Refresh. Filters are applied server-side where
  // available (type/status) and client-side for free-text search so
  // the admin can drill in without round-tripping every keystroke.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (statusFilter) params.set("status", statusFilter);

    fetch(`/api/admin/chats${params.toString() ? `?${params}` : ""}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as ListResponse;
        if (cancelled) return;
        if (!res.ok || !json?.ok) {
          setError(
            json?.error || `Failed to load chat threads (${res.status})`
          );
          setThreads([]);
          setStats(null);
          return;
        }
        setThreads(Array.isArray(json.threads) ? json.threads : []);
        setStats(json.stats ?? null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
        setThreads([]);
        setStats(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, typeFilter, statusFilter, refreshKey]);

  const filteredThreads = useMemo(() => {
    if (!threads) return null;
    const q = search.trim().toLowerCase();
    if (!q) return threads;
    return threads.filter((t) => {
      const haystacks = [
        t.threadId,
        t.taskOrNeedId,
        t.displayId,
        t.userPhone,
        t.providerName,
        t.providerPhone,
        t.providerId,
        t.category,
        t.area,
        t.lastMessagePreview,
      ];
      return haystacks
        .map((v) => String(v ?? "").toLowerCase())
        .some((v) => v.includes(q));
    });
  }, [threads, search]);

  async function openDetail(thread: ThreadSummary): Promise<void> {
    setActiveThread(thread);
    setDetailMessages([]);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const url = `/api/admin/chats/${encodeURIComponent(
        thread.threadId
      )}?type=${thread.type}`;
      const res = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res
        .json()
        .catch(() => ({}))) as DetailResponse;
      if (!res.ok || !json?.ok) {
        setDetailError(
          json?.error || `Failed to load thread (${res.status})`
        );
        return;
      }
      setDetailMessages(
        Array.isArray(json.messages) ? json.messages : []
      );
      if (json.thread) setActiveThread(json.thread);
    } catch (err) {
      setDetailError(err instanceof Error ? err.message : "Network error");
    } finally {
      setDetailLoading(false);
    }
  }

  function closeDetail(): void {
    setActiveThread(null);
    setDetailMessages([]);
    setDetailError(null);
    setDetailLoading(false);
  }

  const summary =
    stats !== null
      ? `${stats.total} thread${stats.total === 1 ? "" : "s"} · ${stats.active} active · ${stats.closed} closed`
      : "User ↔ provider chat threads";

  return (
    <section
      data-testid="chats-tab"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="chats-tab-body"
        data-testid="chats-tab-toggle"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="flex items-center text-base font-semibold text-slate-900">
            Chats
            <UnreadBadge unread={unread} testId="chats-unread-badge" />
          </p>
          <p className="mt-0.5 text-xs text-slate-500">{summary}</p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>

      {isOpen && (
        <div
          id="chats-tab-body"
          className="border-t border-slate-200 px-5 py-5"
        >
          {/* Summary stat cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard
              label="Total"
              value={stats?.total ?? "—"}
              testId="chats-stat-total"
              accent="text-[#003d20]"
            />
            <StatCard
              label="Active"
              value={stats?.active ?? "—"}
              testId="chats-stat-active"
              accent="text-emerald-700"
            />
            <StatCard
              label="Closed"
              value={stats?.closed ?? "—"}
              testId="chats-stat-closed"
              accent="text-slate-700"
            />
            <StatCard
              label="Task / I-Need"
              value={
                stats
                  ? `${stats.task} / ${stats.need}`
                  : "—"
              }
              testId="chats-stat-split"
              accent="text-slate-900"
            />
          </div>

          {/* Filter bar */}
          <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="text-xs font-medium text-slate-700">
              Type
              <select
                value={typeFilter}
                onChange={(e) =>
                  setTypeFilter(e.target.value as ChatTypeFilter)
                }
                data-testid="chats-type-filter"
                className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
              >
                <option value="all">All</option>
                <option value="task">Task Chat</option>
                <option value="need">I-Need Chat</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              Status
              <select
                value={statusFilter}
                onChange={(e) =>
                  setStatusFilter(e.target.value as ChatStatusFilter)
                }
                data-testid="chats-status-filter"
                className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
              >
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="closed">Closed</option>
                <option value="flagged">Flagged</option>
                <option value="muted">Muted</option>
                <option value="locked">Locked</option>
              </select>
            </label>
            <label className="min-w-[12rem] flex-1 text-xs font-medium text-slate-700">
              Search
              <input
                type="search"
                placeholder="Phone, Kaam No, category, area…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="chats-search"
                className="ml-2 w-full rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
              />
            </label>
            <button
              type="button"
              onClick={() => setRefreshKey((v) => v + 1)}
              data-testid="chats-refresh"
              className="ml-auto inline-flex items-center rounded-lg border border-[#003d20] bg-white px-3 py-1.5 text-xs font-semibold text-[#003d20] transition hover:bg-emerald-50"
            >
              Refresh
            </button>
          </div>

          {/* States */}
          {error && (
            <p
              data-testid="chats-error"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          )}

          {loading && !threads && (
            <p
              data-testid="chats-loading"
              className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500"
            >
              Loading chat threads…
            </p>
          )}

          {!loading &&
            filteredThreads &&
            filteredThreads.length === 0 &&
            !error && (
              <p
                data-testid="chats-empty"
                className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500"
              >
                {threads && threads.length > 0
                  ? "No chat threads match the current filters."
                  : "No chat threads yet."}
              </p>
            )}

          {filteredThreads && filteredThreads.length > 0 && (
            <>
              {/* Desktop table view */}
              <div className="mt-4 hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
                <table
                  data-testid="chats-table"
                  className="min-w-full divide-y divide-slate-200 text-sm"
                >
                  <thead className="bg-slate-50">
                    <tr>
                      <Th>Type</Th>
                      <Th>Thread</Th>
                      <Th>Kaam / Need</Th>
                      <Th>User</Th>
                      <Th>Provider</Th>
                      <Th>Category</Th>
                      <Th>Area</Th>
                      <Th>Last Message</Th>
                      <Th>Last At</Th>
                      <Th>Status</Th>
                      <Th>Actions</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredThreads.map((row) => (
                      <tr
                        key={row.threadId}
                        data-testid={`chats-row-${row.threadId}`}
                      >
                        <td className="whitespace-nowrap px-3 py-3 align-top">
                          <TypeBadge type={row.type} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 align-top">
                          <span
                            className="block max-w-[10rem] truncate font-mono text-xs text-slate-700"
                            title={row.threadId}
                          >
                            {row.threadId}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 align-top">
                          <KaamCell row={row} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 align-top font-mono text-slate-700">
                          {row.userPhone || "—"}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 align-top">
                          <ProviderCell row={row} />
                        </td>
                        <td className="px-3 py-3 align-top text-slate-700">
                          {row.category || "—"}
                        </td>
                        <td className="px-3 py-3 align-top text-slate-700">
                          {row.area || "—"}
                        </td>
                        <td className="max-w-[22rem] px-3 py-3 align-top">
                          <p className="line-clamp-2 text-xs text-slate-700">
                            {row.lastMessagePreview || "—"}
                          </p>
                          {row.lastMessageBy ? (
                            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-slate-400">
                              by {row.lastMessageBy}
                            </p>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 align-top text-xs text-slate-600">
                          {formatDate(row.lastMessageAt)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 align-top">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 align-top">
                          <button
                            type="button"
                            onClick={() => void openDetail(row)}
                            data-testid={`chats-view-${row.threadId}`}
                            className="inline-flex items-center rounded-md border border-[#003d20] bg-[#003d20] px-2.5 py-1 text-xs font-semibold text-white transition hover:bg-[#005533]"
                          >
                            View Chat
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="mt-4 grid gap-3 md:hidden">
                {filteredThreads.map((row) => (
                  <article
                    key={row.threadId}
                    data-testid={`chats-card-${row.threadId}`}
                    className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <TypeBadge type={row.type} />
                      <StatusBadge status={row.status} />
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-slate-700">
                      <KaamCell row={row} />
                      <p>
                        <span className="font-semibold text-slate-500">
                          User:
                        </span>{" "}
                        <span className="font-mono">
                          {row.userPhone || "—"}
                        </span>
                      </p>
                      <p>
                        <span className="font-semibold text-slate-500">
                          Provider:
                        </span>{" "}
                        <ProviderCell row={row} inline />
                      </p>
                      {row.category ? (
                        <p>
                          <span className="font-semibold text-slate-500">
                            Category:
                          </span>{" "}
                          {row.category}
                        </p>
                      ) : null}
                      {row.area ? (
                        <p>
                          <span className="font-semibold text-slate-500">
                            Area:
                          </span>{" "}
                          {row.area}
                        </p>
                      ) : null}
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs text-slate-700">
                      {row.lastMessagePreview || "—"}
                    </p>
                    <p className="mt-0.5 text-[10px] text-slate-500">
                      {formatDate(row.lastMessageAt)}
                    </p>
                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void openDetail(row)}
                        className="inline-flex items-center rounded-md border border-[#003d20] bg-[#003d20] px-3 py-1 text-xs font-semibold text-white transition hover:bg-[#005533]"
                      >
                        View Chat
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Read-only detail modal */}
      {activeThread ? (
        <ChatDetailModal
          thread={activeThread}
          messages={detailMessages}
          loading={detailLoading}
          error={detailError}
          onClose={closeDetail}
        />
      ) : null}
    </section>
  );
}

function StatCard({
  label,
  value,
  testId,
  accent,
}: {
  label: string;
  value: number | string;
  testId: string;
  accent: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p
        data-testid={testId}
        className={`mt-1 text-2xl font-bold ${accent}`}
      >
        {value}
      </p>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600"
    >
      {children}
    </th>
  );
}

function TypeBadge({ type }: { type: ChatType }) {
  return (
    <span
      data-testid={`chats-type-${type}`}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${TYPE_BADGE_CLASS[type]}`}
    >
      {TYPE_LABEL[type]}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      data-testid={`chats-status-${status}`}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(status)}`}
    >
      {status}
    </span>
  );
}

function KaamCell({ row }: { row: ThreadSummary }) {
  if (row.type === "task") {
    const display = row.displayId || row.taskOrNeedId || "—";
    return (
      <span
        className="block max-w-[12rem] truncate font-mono text-xs text-slate-900"
        title={row.taskOrNeedId}
      >
        {display}
      </span>
    );
  }
  return (
    <span
      className="block max-w-[12rem] truncate font-mono text-xs text-slate-900"
      title={row.taskOrNeedId}
    >
      Need: {row.taskOrNeedId || "—"}
    </span>
  );
}

function ProviderCell({
  row,
  inline,
}: {
  row: ThreadSummary;
  inline?: boolean;
}) {
  const name = row.providerName || row.providerId || "—";
  const phone = row.providerPhone || "";
  if (inline) {
    return (
      <>
        <span className="text-slate-900">{name}</span>
        {phone ? (
          <span className="ml-1 font-mono text-slate-600">({phone})</span>
        ) : null}
      </>
    );
  }
  return (
    <div className="flex min-w-0 flex-col">
      <span className="truncate text-slate-900">{name}</span>
      {phone ? (
        <span className="mt-0.5 font-mono text-[11px] text-slate-500">
          {phone}
        </span>
      ) : null}
    </div>
  );
}

function ChatDetailModal({
  thread,
  messages,
  loading,
  error,
  onClose,
}: {
  thread: ThreadSummary;
  messages: ChatMessage[];
  loading: boolean;
  error: string | null;
  onClose: () => void;
}) {
  // Close on Escape — small ergonomics win for an admin who is
  // keyboard-scanning many threads in sequence.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Chat thread ${thread.threadId}`}
      data-testid="chats-detail-modal"
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 px-2 py-4 sm:items-center sm:p-6"
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl">
        <header className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <TypeBadge type={thread.type} />
              <StatusBadge status={thread.status} />
            </div>
            <p
              className="mt-1 truncate font-mono text-xs text-slate-500"
              title={thread.threadId}
            >
              {thread.threadId}
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-slate-600 sm:grid-cols-3">
              <DetailRow label="Kaam / Need">
                <KaamCell row={thread} />
              </DetailRow>
              <DetailRow label="User">
                <span className="font-mono">{thread.userPhone || "—"}</span>
              </DetailRow>
              <DetailRow label="Provider">
                <ProviderCell row={thread} inline />
              </DetailRow>
              {thread.category ? (
                <DetailRow label="Category">{thread.category}</DetailRow>
              ) : null}
              {thread.area ? (
                <DetailRow label="Area">{thread.area}</DetailRow>
              ) : null}
              <DetailRow label="Created">
                {formatDate(thread.createdAt)}
              </DetailRow>
            </dl>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-testid="chats-detail-close"
            aria-label="Close chat detail"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto bg-slate-50 px-4 py-4">
          {loading ? (
            <p
              data-testid="chats-detail-loading"
              className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500"
            >
              Loading messages…
            </p>
          ) : error ? (
            <p
              data-testid="chats-detail-error"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {error}
            </p>
          ) : messages.length === 0 ? (
            <p
              data-testid="chats-detail-empty"
              className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500"
            >
              No messages in this thread yet.
            </p>
          ) : (
            <ul className="space-y-3" data-testid="chats-detail-messages">
              {messages.map((message) => (
                <li
                  key={message.messageId}
                  data-testid={`chats-message-${message.messageId}`}
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${SENDER_BADGE_CLASS[message.sender]}`}
                    >
                      {SENDER_LABEL[message.sender]}
                      {message.rawSender &&
                      message.rawSender.toLowerCase() !== message.sender ? (
                        <span className="ml-1 lowercase opacity-70">
                          ({message.rawSender})
                        </span>
                      ) : null}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {formatDate(message.createdAt)}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">
                    {message.text || "—"}
                  </p>
                  {message.senderPhone || message.senderName ? (
                    <p className="mt-1 text-[10px] text-slate-500">
                      {message.senderName ? (
                        <span className="text-slate-700">
                          {message.senderName}
                        </span>
                      ) : null}
                      {message.senderName && message.senderPhone ? " · " : ""}
                      {message.senderPhone ? (
                        <span className="font-mono">
                          {message.senderPhone}
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <footer className="border-t border-slate-200 bg-white px-4 py-2 text-[11px] text-slate-500">
          Read-only monitor view. Use the legacy /admin/chats page to
          take moderation actions.
        </footer>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-baseline gap-1.5">
      <dt className="shrink-0 font-semibold text-slate-500">{label}:</dt>
      <dd className="min-w-0 truncate text-slate-800">{children}</dd>
    </div>
  );
}
