"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";

// Phase 1 — in-app bell. Polls /api/admin/notifications on mount and
// every 45 seconds while the admin dashboard is mounted. No browser
// push, no FCM, no service worker — those land in Phase 2.

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

const POLL_INTERVAL_MS = 45_000;

const SEVERITY_DOT_CLASS: Record<Severity, string> = {
  critical: "bg-red-500",
  warning: "bg-amber-500",
  info: "bg-sky-500",
};

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

function normaliseSeverity(value: string | null | undefined): Severity {
  const v = String(value ?? "info").trim().toLowerCase();
  if (v === "critical" || v === "warning") return v;
  return "info";
}

export default function AdminNotificationBell() {
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/admin/notifications", {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as LoadResponse;
      if (!res.ok || !json?.success) {
        setError(json?.error || `Failed (${res.status})`);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + polling. Polling continues regardless of dropdown
  // visibility so the badge stays current.
  useEffect(() => {
    void load();
    const id = setInterval(() => {
      void load();
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(id);
    };
  }, [load]);

  // Outside-click close.
  useEffect(() => {
    if (!open) return;
    const onClick = (event: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (
        event.target instanceof Node &&
        !dropdownRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  async function handleClickNotification(n: Notification): Promise<void> {
    // Optimistically mark read in local state so the badge drops
    // immediately even if the network call lags. The poll will reconcile.
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
        // Non-fatal — next poll picks it up.
      }
    }
    if (n.actionUrl) {
      setOpen(false);
      if (typeof window !== "undefined") {
        window.location.assign(n.actionUrl);
      }
    }
  }

  async function handleMarkAllRead(): Promise<void> {
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
        // Roll back the local state on failure so the user can retry.
        setNotifications(previous);
        await load();
      }
    } catch {
      setNotifications(previous);
      await load();
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications — ${unreadCount} unread`}
        aria-expanded={open}
        data-testid="admin-notification-bell"
        className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 transition hover:bg-slate-50"
      >
        <Bell aria-hidden="true" className="h-5 w-5" />
        {unreadCount > 0 && (
          <span
            data-testid="admin-notification-bell-badge"
            className="absolute -right-1 -top-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full border-2 border-white bg-red-600 px-1 text-[10px] font-bold leading-none text-white"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          data-testid="admin-notification-dropdown"
          role="dialog"
          aria-label="Notifications"
          className="absolute right-0 z-40 mt-2 flex w-[22rem] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <p className="text-sm font-semibold text-slate-900">
              Notifications
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => void handleMarkAllRead()}
                disabled={unreadCount === 0}
                data-testid="admin-notification-mark-all-read"
                className="text-xs font-semibold text-[#003d20] transition hover:underline disabled:cursor-not-allowed disabled:text-slate-400"
              >
                Mark all read
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close notifications"
                className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>

          {error && (
            <p className="border-b border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          <div className="max-h-96 overflow-y-auto">
            {loading && notifications.length === 0 && (
              <p className="px-3 py-6 text-center text-sm text-slate-500">
                Loading…
              </p>
            )}
            {!loading && notifications.length === 0 && !error && (
              <p
                data-testid="admin-notification-empty"
                className="px-3 py-6 text-center text-sm text-slate-500"
              >
                No admin notifications.
              </p>
            )}
            {notifications.length > 0 && (
              <ul className="divide-y divide-slate-100">
                {notifications.map((n) => {
                  const isUnread = !n.readAt;
                  return (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => void handleClickNotification(n)}
                        data-testid={`admin-notification-item-${n.id}`}
                        data-unread={isUnread ? "true" : "false"}
                        className={`flex w-full items-start gap-2 px-3 py-2.5 text-left transition hover:bg-slate-50 ${
                          isUnread ? "bg-amber-50/60" : "bg-white"
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT_CLASS[n.severity]}`}
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={`truncate text-sm ${
                              isUnread
                                ? "font-semibold text-slate-900"
                                : "font-medium text-slate-700"
                            }`}
                          >
                            {n.title}
                          </p>
                          <p className="line-clamp-2 text-xs text-slate-600">
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
        </div>
      )}
    </div>
  );
}
