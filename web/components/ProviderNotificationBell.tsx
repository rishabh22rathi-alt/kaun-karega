"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

export type ProviderNotificationType = "job" | "chat" | "account";

export type ProviderNotificationItem = {
  id: string;
  type: ProviderNotificationType;
  title: string;
  message: string;
  href?: string;
  createdAt?: string;
  seen?: boolean;
};

type Props = {
  notifications: ProviderNotificationItem[];
  unreadCount?: number;
};

const GROUP_LABELS: Record<ProviderNotificationType, string> = {
  job: "Jobs",
  chat: "Chat",
  account: "Account",
};

const GROUP_ORDER: ProviderNotificationType[] = ["job", "chat", "account"];

// Composed-id prefix for DB-backed notifications. The dashboard maps each
// provider_notifications row to an item with id = `db:<uuid>`, so this
// component can recognise which IDs are server-persisted (and therefore
// markable) without a separate `source` field on the item type.
const DB_ID_PREFIX = "db:";

export default function ProviderNotificationBell({ notifications, unreadCount }: Props) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Composed IDs (with the "db:" prefix) that have been locally marked seen
  // since this bell mounted. Used to overlay seen=true on items optimistically
  // while the server roundtrip and the next dashboard poll catch up. The set
  // self-cleans implicitly: once the next poll returns the item with seen=true
  // from the server, the override is redundant but harmless.
  const [locallyMarkedSeen, setLocallyMarkedSeen] = useState<Set<string>>(
    () => new Set()
  );

  // Apply the local-seen overlay so display + counts agree.
  const effectiveNotifications = useMemo(
    () =>
      notifications.map((item) =>
        locallyMarkedSeen.has(item.id) ? { ...item, seen: true } : item
      ),
    [notifications, locallyMarkedSeen]
  );

  const computedUnread = useMemo(() => {
    // The explicit unreadCount prop is honored only when there are no local
    // overrides — otherwise we recompute from the overlaid items so the
    // badge tracks what's actually visible.
    if (typeof unreadCount === "number" && locallyMarkedSeen.size === 0) {
      return Math.max(0, unreadCount);
    }
    return effectiveNotifications.filter((item) => !item.seen).length;
  }, [effectiveNotifications, unreadCount, locallyMarkedSeen]);

  const grouped = useMemo(() => {
    const map: Record<ProviderNotificationType, ProviderNotificationItem[]> = {
      job: [],
      chat: [],
      account: [],
    };
    for (const n of effectiveNotifications) {
      map[n.type].push(n);
    }
    return map;
  }, [effectiveNotifications]);

  // Mark DB-backed unseen notifications as seen the moment the panel opens.
  // Derived items (id without "db:" prefix) are intentionally skipped — they
  // have no server row to update; their unread state is already a function of
  // current dashboard data and resets naturally on next refresh.
  useEffect(() => {
    if (!open) return;

    const dbUnseen = notifications.filter(
      (item) =>
        item.id.startsWith(DB_ID_PREFIX) &&
        !item.seen &&
        !locallyMarkedSeen.has(item.id)
    );
    if (dbUnseen.length === 0) return;

    const composedIds = dbUnseen.map((item) => item.id);
    const dbUuids = dbUnseen.map((item) =>
      item.id.slice(DB_ID_PREFIX.length)
    );

    // Optimistic local mark first — badge clears immediately. If the POST
    // fails, the next dashboard poll (60s) reconciles by re-presenting the
    // unseen state from the server and the badge restores itself.
    setLocallyMarkedSeen((prev) => {
      const next = new Set(prev);
      composedIds.forEach((id) => next.add(id));
      return next;
    });

    void fetch("/api/provider/notifications/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: dbUuids }),
    }).catch(() => {
      // Soft-fail. Optimistic state stays; server is the eventual truth.
    });
    // Intentionally only fire on `open` transitions, not on every
    // notifications-array reference change. The `!locallyMarkedSeen.has(...)`
    // filter would make multi-fire safe but unnecessary work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hasBadge = computedUnread > 0;
  const badgeText =
    computedUnread > 9 ? "9+" : computedUnread >= 2 ? String(computedUnread) : "";
  const allEmpty = GROUP_ORDER.every((g) => grouped[g].length === 0);

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        aria-label={
          hasBadge ? `Notifications, ${computedUnread} unread` : "Notifications"
        }
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((s) => !s)}
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-full bg-[#003d20] text-[#f97316] shadow-md transition hover:bg-[#002a16] hover:shadow-lg"
      >
        <svg
          viewBox="0 0 24 24"
          className="h-5 w-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10 21a2 2 0 0 0 4 0" />
        </svg>
        {hasBadge ? (
          badgeText ? (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full bg-[#f97316] px-1 text-[10px] font-bold leading-none text-white shadow-sm ring-2 ring-[#003d20]"
            >
              {badgeText}
            </span>
          ) : (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 h-3 w-3 rounded-full bg-[#f97316] shadow-sm ring-2 ring-[#003d20]"
            />
          )
        ) : null}
      </button>

      {open ? (
        <>
          {/* Backdrop dimmer — mobile only. Tap to dismiss. */}
          <div
            aria-hidden="true"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 bg-slate-900/30 md:hidden"
          />

          {/*
            Panel: bottom-sheet on mobile, anchored dropdown on md+.
            Single element, classes flip at the md breakpoint so we don't
            duplicate JSX.
          */}
          <div
            role="menu"
            aria-label="Provider notifications"
            className="fixed inset-x-0 bottom-0 z-50 flex max-h-[85vh] flex-col overflow-hidden rounded-t-3xl border-t border-slate-200 bg-white shadow-[0_-20px_60px_rgba(15,23,42,0.22)] md:absolute md:inset-x-auto md:bottom-auto md:right-0 md:top-12 md:max-h-[60vh] md:w-[min(22rem,calc(100vw-2rem))] md:rounded-2xl md:border md:shadow-[0_20px_60px_rgba(15,23,42,0.18)]"
          >
            {/* Drag handle — mobile only, gives the sheet a tactile cue. */}
            <div
              aria-hidden="true"
              className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-slate-200 md:hidden"
            />

            <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-bold text-[#003d20]">Notifications</p>
              <div className="flex items-center gap-2">
                {hasBadge ? (
                  <span className="text-xs font-semibold text-[#003d20]/70">
                    {computedUnread > 9 ? "9+" : computedUnread} unread
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-[#003d20]"
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {allEmpty ? (
                <div className="px-4 py-10 text-center text-sm text-slate-500">
                  No new notifications.
                </div>
              ) : (
                GROUP_ORDER.map((groupKey) => {
                  const items = grouped[groupKey];
                  if (items.length === 0) return null;
                  return (
                    <div
                      key={groupKey}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <p className="px-4 pb-1 pt-3 text-[11px] font-bold uppercase tracking-wide text-orange-500">
                        {GROUP_LABELS[groupKey]}
                      </p>
                      <ul>
                        {items.map((item) => {
                          const inner = (
                            <div className="flex flex-col gap-0.5 px-4 py-3 transition hover:bg-orange-50">
                              <p className="text-sm font-semibold text-[#003d20]">
                                {item.title}
                              </p>
                              <p className="text-xs leading-5 text-slate-600">
                                {item.message}
                              </p>
                            </div>
                          );
                          return (
                            <li key={item.id}>
                              {item.href ? (
                                <Link
                                  href={item.href}
                                  onClick={() => setOpen(false)}
                                  className="block"
                                >
                                  {inner}
                                </Link>
                              ) : (
                                <div>{inner}</div>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
