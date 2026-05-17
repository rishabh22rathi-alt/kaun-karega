"use client";

import NotificationPreferencesCard from "@/components/NotificationPreferencesCard";
import { ADMIN_NOTIFICATION_TOGGLES } from "@/lib/notificationPreferenceUiConfig";

// Dedicated admin notification preferences page (Phase 5A).
// Auth is enforced by web/app/admin/layout.tsx → AdminLayoutClient,
// which redirects non-admin sessions to /login before this page mounts.
// The /api/admin/notification-preferences route also gates with
// requireAdminSession as defense in depth.

export default function AdminNotificationsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-2">
      <NotificationPreferencesCard
        scope="admin"
        apiPath="/api/admin/notification-preferences"
        toggles={ADMIN_NOTIFICATION_TOGGLES}
        title="Notifications"
        subtitle="Choose which admin notifications you want to receive."
      />
    </div>
  );
}
