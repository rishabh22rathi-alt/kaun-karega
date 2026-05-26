"use client";

import ProviderAlertsFeed from "@/components/alerts/ProviderAlertsFeed";
import { useSessionGuard } from "@/lib/useSessionGuard";

// Provider alerts feed page. Consumes GET /api/provider/notifications
// (same endpoint and shape as ProviderNotificationBell) and posts
// mark-seen against POST /api/provider/notifications/seen on first
// load. The desktop bell continues to work independently on >= md.
//
// Auth mirrors /provider/notifications: useSessionGuard pings whoami
// on mount + focus, redirecting to /login on stale sessions. The API
// itself enforces provider-ness.

export default function ProviderAlertsPage() {
  useSessionGuard({ redirectTo: "/login?next=/provider/alerts" });

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)] px-4 py-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header>
          <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-600">
            Matched jobs, chat updates, and account events.
          </p>
        </header>
        <ProviderAlertsFeed />
      </div>
    </main>
  );
}
