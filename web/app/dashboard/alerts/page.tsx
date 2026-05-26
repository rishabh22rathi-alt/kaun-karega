"use client";

import UserAlertsEmptyState from "@/components/alerts/UserAlertsEmptyState";

// User alerts feed page. v1: no user-feed API exists yet, so this is
// a static empty state with a small "Adjust notification settings"
// link out to /dashboard/notifications. When a `/api/user/notifications`
// endpoint ships, swap UserAlertsEmptyState for a UserAlertsFeed that
// mirrors ProviderAlertsFeed.
//
// Auth: /dashboard/* is gated by the dashboard layout's session check.

export default function UserAlertsPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)] px-4 py-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <header>
          <h1 className="text-xl font-bold text-slate-900">Notifications</h1>
          <p className="mt-1 text-sm text-slate-600">
            Updates about your requests.
          </p>
        </header>
        <UserAlertsEmptyState />
      </div>
    </main>
  );
}
