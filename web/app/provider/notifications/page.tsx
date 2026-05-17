"use client";

import NotificationPreferencesCard from "@/components/NotificationPreferencesCard";
import { PROVIDER_NOTIFICATION_TOGGLES } from "@/lib/notificationPreferenceUiConfig";
import { useSessionGuard } from "@/lib/useSessionGuard";

// Dedicated provider notification preferences page (Phase 3.5).
// Replaces the dashboard-embedded card so the entry point is discoverable
// from the sidebar instead of buried below seven dashboard sections.
//
// Auth model mirrors /provider/dashboard:
//   • useSessionGuard pings /api/auth/whoami on mount + focus and
//     redirects to /login?next=/provider/notifications on stale.
//   • Provider-ness is enforced by the API
//     (/api/notification-preferences returns 404 PROVIDER_NOT_FOUND if
//     the session phone has no providers row), and the card surfaces
//     that as a loadError.

export default function ProviderNotificationsPage() {
  useSessionGuard({ redirectTo: "/login?next=/provider/notifications" });

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)] px-4 py-8">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <NotificationPreferencesCard
          scope="provider"
          apiPath="/api/notification-preferences"
          toggles={PROVIDER_NOTIFICATION_TOGGLES}
          title="Notifications"
          subtitle="Choose which notifications you want to receive."
        />
      </div>
    </main>
  );
}
