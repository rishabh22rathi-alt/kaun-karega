"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import ProviderNotificationBell, {
  type ProviderNotificationItem,
} from "./ProviderNotificationBell";
import { getAuthSession } from "@/lib/auth";
import { PROVIDER_PROFILE_UPDATED_EVENT } from "./sidebarEvents";

const POLL_INTERVAL_MS = 60_000;

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

function mapType(rawType: string): ProviderNotificationItem["type"] {
  if (rawType === "job_matched") return "job";
  if (rawType === "chat_message") return "chat";
  return "account";
}

export default function GlobalProviderNotificationBell() {
  const pathname = usePathname();
  const [hydrated, setHydrated] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  // null = unknown, true = registered provider, false = 404 from the API
  const [isProvider, setIsProvider] = useState<boolean | null>(null);
  const [notifications, setNotifications] = useState<ProviderNotificationItem[]>(
    []
  );

  useEffect(() => {
    setHydrated(true);
    setPhone(getAuthSession()?.phone ?? null);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const refresh = () => setPhone(getAuthSession()?.phone ?? null);
    window.addEventListener("storage", refresh);
    window.addEventListener(PROVIDER_PROFILE_UPDATED_EVENT, refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener(PROVIDER_PROFILE_UPDATED_EVENT, refresh);
    };
  }, []);

  // /admin runs on its own session model and has no provider context — keep
  // the bell out of those routes entirely.
  const shouldHide = useMemo(() => {
    if (!pathname) return true;
    if (pathname.startsWith("/admin")) return true;
    return false;
  }, [pathname]);

  useEffect(() => {
    if (!hydrated || !phone || shouldHide) return;
    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch("/api/provider/notifications", {
          cache: "no-store",
        });
        if (cancelled) return;
        if (res.status === 404) {
          setIsProvider(false);
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as NotificationsResponse;
        if (cancelled || !data?.ok) return;
        const mapped: ProviderNotificationItem[] = (data.notifications || []).map(
          (row) => ({
            id: `db:${row.id}`,
            type: mapType(String(row.type || "")),
            title: row.title || "Notification",
            message: row.message || "",
            href: row.href || "/provider/dashboard",
            createdAt: row.createdAt,
            seen: Boolean(row.seen),
          })
        );
        setNotifications(mapped);
        setIsProvider(true);
      } catch {
        // Soft fail; keep last known notifications so a transient blip
        // doesn't blank the bell.
      }
    };

    void load();
    const interval = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [hydrated, phone, shouldHide]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.seen).length,
    [notifications]
  );

  if (!hydrated || !phone || shouldHide || isProvider === false) return null;

  // The wrapper class triggers the shake keyframe defined in globals.css.
  // The bell button self-disables the animation via aria-expanded so the
  // panel isn't jiggling while the user is reading it.
  const wrapperClass = unreadCount > 0 ? "kk-bell-attention" : undefined;

  return (
    <div className={wrapperClass}>
      <ProviderNotificationBell
        notifications={notifications}
        unreadCount={unreadCount}
      />
    </div>
  );
}
