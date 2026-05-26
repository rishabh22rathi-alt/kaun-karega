"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Briefcase, MessageCircle, User, Inbox } from "lucide-react";

/**
 * Provider alerts feed page UI.
 *
 * Mirrors the data + mark-seen pipeline used by ProviderNotificationBell
 * (web/components/ProviderNotificationBell.tsx) so the desktop dropdown
 * and this mobile page stay perceptually identical:
 *   - GET /api/provider/notifications every 45s.
 *   - Items grouped Jobs / Chat / Account by `type` field.
 *   - On first successful load, POST /api/provider/notifications/seen
 *     with the unseen `db:`-prefixed ids; UI optimistically marks them
 *     read so the bold-emphasis clears immediately.
 *
 * If the bell rendering changes, this file should change in lockstep.
 * The shared invariants are intentionally NOT extracted into a single
 * component yet — see the audit plan; consolidation is a v2 task.
 */

const POLL_INTERVAL_MS = 60_000;
const DB_ID_PREFIX = "db:";

type NotificationsRow = {
  id: string;
  type: string;
  title: string;
  message: string;
  href?: string;
  createdAt?: string;
  seen?: boolean;
};

type NotificationsResponse = {
  ok?: boolean;
  notifications?: NotificationsRow[];
};

type Group = "job" | "chat" | "account";

const GROUP_LABEL: Record<Group, string> = {
  job: "Jobs",
  chat: "Chat",
  account: "Account",
};

const GROUP_ORDER: Group[] = ["job", "chat", "account"];

const GROUP_ICON: Record<Group, React.ComponentType<{ className?: string }>> = {
  job: Briefcase,
  chat: MessageCircle,
  account: User,
};

function mapType(rawType: string): Group {
  if (rawType === "job_matched") return "job";
  if (rawType === "chat_message") return "chat";
  return "account";
}

function formatRelative(value: string | undefined): string {
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

export default function ProviderAlertsFeed() {
  const [items, setItems] = useState<NotificationsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locallyMarkedSeen, setLocallyMarkedSeen] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    let cancelled = false;
    let didInitialMarkSeen = false;

    const fireMarkSeen = (rows: NotificationsRow[]): void => {
      if (didInitialMarkSeen) return;
      const unseen = rows.filter(
        (row) => row.id.startsWith(DB_ID_PREFIX) && !row.seen
      );
      if (unseen.length === 0) {
        didInitialMarkSeen = true;
        return;
      }
      didInitialMarkSeen = true;
      const composedIds = unseen.map((row) => row.id);
      const dbUuids = unseen.map((row) => row.id.slice(DB_ID_PREFIX.length));
      setLocallyMarkedSeen((prev) => {
        const next = new Set(prev);
        composedIds.forEach((id) => next.add(id));
        return next;
      });
      void fetch("/api/provider/notifications/seen", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: dbUuids }),
      }).catch(() => {
        // Soft-fail. The next poll re-presents unseen state from the
        // server if our POST never landed.
      });
    };

    const load = async (): Promise<void> => {
      try {
        const res = await fetch("/api/provider/notifications", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        if (cancelled) return;
        if (!res.ok) {
          setError(`Failed to load notifications (${res.status})`);
          setLoading(false);
          return;
        }
        const data = (await res
          .json()
          .catch(() => ({}))) as NotificationsResponse;
        if (cancelled) return;
        if (!data?.ok) {
          setError("Notifications service returned an error.");
          setLoading(false);
          return;
        }
        const rows = Array.isArray(data.notifications) ? data.notifications : [];
        setItems(rows);
        setError(null);
        setLoading(false);
        fireMarkSeen(rows);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Network error");
        setLoading(false);
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const effectiveItems = useMemo(
    () =>
      items.map((item) =>
        locallyMarkedSeen.has(item.id) ? { ...item, seen: true } : item
      ),
    [items, locallyMarkedSeen]
  );

  const grouped = useMemo(() => {
    const map: Record<Group, NotificationsRow[]> = {
      job: [],
      chat: [],
      account: [],
    };
    for (const item of effectiveItems) {
      map[mapType(item.type)].push(item);
    }
    return map;
  }, [effectiveItems]);

  const allEmpty = GROUP_ORDER.every((g) => grouped[g].length === 0);

  if (loading) {
    return (
      <div className="space-y-3" data-testid="provider-alerts-loading">
        {[0, 1, 2, 3].map((row) => (
          <div
            key={row}
            className="h-16 animate-pulse rounded-xl bg-white/70 ring-1 ring-slate-200"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        data-testid="provider-alerts-error"
        className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        Could not load notifications. {error}
      </div>
    );
  }

  if (allEmpty) {
    return (
      <section
        data-testid="provider-alerts-empty"
        className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm"
      >
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
          <Inbox className="h-6 w-6 text-slate-400" aria-hidden="true" />
        </div>
        <h2 className="mt-4 text-lg font-semibold text-slate-900">
          No notifications yet
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          New matched jobs and chat messages will show up here.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4" data-testid="provider-alerts-feed">
      {GROUP_ORDER.map((groupKey) => {
        const groupItems = grouped[groupKey];
        if (groupItems.length === 0) return null;
        const GroupIcon = GROUP_ICON[groupKey];
        return (
          <section
            key={groupKey}
            data-testid={`provider-alerts-group-${groupKey}`}
            className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <header className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
              <GroupIcon className="h-4 w-4 text-[#003d20]" aria-hidden="true" />
              <p className="text-[11px] font-bold uppercase tracking-wide text-[#003d20]">
                {GROUP_LABEL[groupKey]}
              </p>
            </header>
            <ul className="divide-y divide-slate-100">
              {groupItems.map((item) => {
                const isUnread = !item.seen;
                const innerContent = (
                  <div className="flex flex-col gap-0.5 px-4 py-3 transition hover:bg-orange-50/60">
                    <p
                      className={`text-sm ${
                        isUnread
                          ? "font-semibold text-slate-900"
                          : "font-medium text-slate-700"
                      }`}
                    >
                      {item.title}
                    </p>
                    <p className="line-clamp-2 text-xs leading-5 text-slate-600">
                      {item.message}
                    </p>
                    {item.createdAt ? (
                      <p className="mt-1 text-[11px] text-slate-400">
                        {formatRelative(item.createdAt)}
                      </p>
                    ) : null}
                  </div>
                );
                return (
                  <li key={item.id}>
                    {item.href ? (
                      <Link
                        href={item.href}
                        prefetch={false}
                        className="block"
                      >
                        {innerContent}
                      </Link>
                    ) : (
                      <div>{innerContent}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
