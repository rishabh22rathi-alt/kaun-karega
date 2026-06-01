"use client";

import AdminAlertsFeed from "@/components/alerts/AdminAlertsFeed";
import AdminPushControls from "@/components/admin/AdminPushControls";

// Admin alerts feed page. Consumes GET /api/admin/notifications and
// POST /api/admin/notifications/mark-read — same endpoints
// AdminNotificationBell uses on desktop. The bell continues to render
// at >= md (its desktop-only mount is enforced in AdminTopbar).
//
// Auth is owned by AdminLayoutClient: this page tree only renders
// after `loading === false` and a valid admin session is verified.

export default function AdminAlertsPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 py-2">
      <AdminPushControls />
      <AdminAlertsFeed />
    </div>
  );
}
