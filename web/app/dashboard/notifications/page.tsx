"use client";

import NotificationPreferencesCard from "@/components/NotificationPreferencesCard";
import { USER_NOTIFICATION_TOGGLES } from "@/lib/notificationPreferenceUiConfig";

// Dedicated user notification preferences page (Phase 4A).
// Auth is enforced by web/app/dashboard/layout.tsx, which redirects
// logged-out visitors to /login before this page mounts. No additional
// session guard needed here.

export default function UserNotificationsPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)] px-4 py-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <NotificationPreferencesCard
          scope="user"
          apiPath="/api/notification-preferences/user"
          toggles={USER_NOTIFICATION_TOGGLES}
          title="Notifications"
          subtitle="Choose which notifications you want to receive."
        />
      </div>
    </main>
  );
}
