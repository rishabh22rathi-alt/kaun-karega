"use client";

import { useCallback, useEffect, useState } from "react";
import { Inbox } from "lucide-react";

/**
 * Admin alerts feed page UI.
 *
 * Mirrors the data + mark-read pipeline used by AdminNotificationBell
 * (web/components/admin/AdminNotificationBell.tsx) so the desktop
 * dropdown and this mobile page render the same information:
 *   - GET /api/admin/notifications every 45s.
 *   - Items rendered with severity dots; unread items get an amber
 *     tint and bolder title.
 *   - Per-item click: optimistic local mark-read + POST
 *     /api/admin/notifications/mark-read { id }, then navigate to
 *     `actionUrl` if present.
 *   - Header "Mark all read" button: optimistic mark-all + POST
 *     /api/admin/notifications/mark-read { all: true }; rolls back on
 *     network failure.
 *
 * If the bell's interaction model changes, update both files in
 * lockstep. Shared invariants are intentionally NOT extracted yet — a
 * v2 task once the surfaces have settled.
 */

const POLL_INTERVAL_MS = 60_000;

type Severity = "critical" | "warning" | "info";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: Severity;
  source: string | null;
  relatedId: string | null;
  actionUrl: string | null;
  readAt: string | null;
  createdAt: string;
};

type LoadResponse = {
  success?: boolean;
  unreadCount?: number;
  notifications?: Notification[];
  error?: string;
};

const SEVERITY_DOT_CLASS: Record<Severity, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-sky-500",
};

function normaliseSeverity(value: string | null | undefined): Severity {
  const v = String(value ?? "info").trim().toLowerCase();
  if (v === "critical" || v === "warning") return v;
  return "info";
}

function formatRelative(value: string): string {
  if (!value) return "";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "";
  const deltaMs = Date.now() - ts;
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  try {
    return new Date(ts).toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

export default function AdminAlertsFeed() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      setError(null);
      const res = await fetch("/api/admin/notifications", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as LoadResponse;
      if (!res.ok || !json?.success) {
        setError(json?.error || `Failed (${res.status})`);
        setLoading(false);
        return;
      }
      const items = Array.isArray(json.notifications)
        ? json.notifications.map((n) => ({
            ...n,
            severity: normaliseSeverity(n.severity),
          }))
        : [];
      setNotifications(items);
      setUnreadCount(
        typeof json.unreadCount === "number" ? json.unreadCount : 0
      );
      setLoading(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [load]);

  const handleClick = async (n: Notification): Promise<void> => {
    if (!n.readAt) {
      setNotifications((prev) =>
        prev.map((row) =>
          row.id === n.id ? { ...row, readAt: new Date().toISOString() } : row
        )
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      try {
        await fetch("/api/admin/notifications/mark-read", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: n.id }),
        });
      } catch {
        // Soft fail — next poll reconciles.
      }
    }
    if (n.actionUrl && typeof window !== "undefined") {
      window.location.assign(n.actionUrl);
    }
  };

  const handleMarkAllRead = async (): Promise<void> => {
    if (markingAll || unreadCount === 0) return;
    setMarkingAll(true);
    const previous = notifications;
    setNotifications((prev) =>
      prev.map((row) =>
        row.readAt ? row : { ...row, readAt: new Date().toISOString() }
      )
    );
    setUnreadCount(0);
    try {
      const res = await fetch("/api/admin/notifications/mark-read", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) {
        setNotifications(previous);
        await load();
      }
    } catch {
      setNotifications(previous);
      await load();
    } finally {
      setMarkingAll(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="admin-alerts-root">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
          <p className="text-xs text-slate-500">
            Operational alerts and system events.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleMarkAllRead()}
          disabled={markingAll || unreadCount === 0}
          data-testid="admin-alerts-mark-all-read"
          className="inline-flex shrink-0 items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-[#003d20] shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
        >
          Mark all read
        </button>
      </header>

      {loading ? (
        <div className="space-y-3" data-testid="admin-alerts-loading">
          {[0, 1, 2, 3].map((row) => (
            <div
              key={row}
              className="h-16 animate-pulse rounded-xl bg-white ring-1 ring-slate-200"
            />
          ))}
        </div>
      ) : error ? (
        <div
          role="alert"
          data-testid="admin-alerts-error"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          Could not load notifications. {error}
        </div>
      ) : notifications.length === 0 ? (
        <section
          data-testid="admin-alerts-empty"
          className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
            <Inbox className="h-6 w-6 text-slate-400" aria-hidden="true" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-slate-900">
            No admin notifications
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            New operational events will appear here.
          </p>
        </section>
      ) : (
        <ul
          data-testid="admin-alerts-list"
          className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
        >
          {notifications.map((n) => {
            const isUnread = !n.readAt;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => void handleClick(n)}
                  data-testid={`admin-alerts-item-${n.id}`}
                  data-unread={isUnread ? "true" : "false"}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-slate-50 ${
                    isUnread ? "bg-amber-50/60" : "bg-white"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[n.severity]}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={`text-sm ${
                        isUnread
                          ? "font-semibold text-slate-900"
                          : "font-medium text-slate-700"
                      }`}
                    >
                      {n.title}
                    </p>
                    <p className="line-clamp-2 text-xs leading-5 text-slate-600">
                      {n.message}
                    </p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      {formatRelative(n.createdAt)}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
