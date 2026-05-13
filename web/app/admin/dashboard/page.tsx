"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";

import ProvidersTab from "@/components/admin/ProvidersTab";
import CategoryTab from "@/components/admin/CategoryTab";
import AreaTab from "@/components/admin/AreaTab";
import UsersTab from "@/components/admin/UsersTab";
import KaamTab from "@/components/admin/KaamTab";
import SystemHealthTab from "@/components/admin/SystemHealthTab";
import ReportsTab from "@/components/admin/ReportsTab";
import IssueReportsTab from "@/components/admin/IssueReportsTab";
import ChatsTab from "@/components/admin/ChatsTab";
import { useAdminUnread } from "@/components/admin/useAdminUnread";

/**
 * /admin/dashboard — fresh workspace.
 *
 * Auth, sidebar, topbar, and the responsive shell are all owned by
 * AdminLayoutClient (web/components/AdminLayoutClient.tsx) which wraps
 * every /admin route via web/app/admin/layout.tsx. This page only owns
 * the inner content slot — append new collapsible tabs below.
 *
 * Deep-linking — `/admin/dashboard?tab=<key>`:
 *   The sidebar's "Reports" entry navigates to ?tab=reports, which
 *   auto-opens the user-reported-issues accordion (IssueReportsTab).
 *   Add new deep-linkable tabs by:
 *     1) accepting a `defaultOpen` prop on the tab component, and
 *     2) wiring its tab key in `DashboardBody` below.
 *   Existing tabs without `defaultOpen` ignore the query — no
 *   migration needed.
 *
 * Unread badges — see useAdminUnread + UnreadBadge:
 *   The hook polls /api/admin/unread-summary every ~45s and exposes
 *   { unread, markRead }. Each badge-aware tab receives its `unread`
 *   entry and an `onMarkRead` callback; the tab calls `onMarkRead`
 *   the first time it opens, which POSTs /api/admin/mark-tab-read
 *   and locally clears the dot.
 */

function DashboardBody() {
  const searchParams = useSearchParams();
  const activeTab = (searchParams?.get("tab") ?? "").toLowerCase();

  const { unread, markRead } = useAdminUnread();

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Admin Dashboard</h1>
        <p className="mt-1 text-slate-600">
          Build and manage Kaun Karega operations from one place.
        </p>
      </div>

      <ProvidersTab />
      <UsersTab
        unread={unread.users}
        onMarkRead={() => void markRead("users")}
      />
      <KaamTab unread={unread.kaam} onMarkRead={() => void markRead("kaam")} />
      <IssueReportsTab
        defaultOpen={activeTab === "reports"}
        unread={unread.reports}
        onMarkRead={() => void markRead("reports")}
      />
      <ChatsTab
        defaultOpen={activeTab === "chats"}
        unread={unread.chats}
        onMarkRead={() => void markRead("chats")}
      />
      <SystemHealthTab />
      <ReportsTab />
      <CategoryTab
        unread={unread.category}
        onMarkRead={() => void markRead("category")}
      />
      <AreaTab />
    </div>
  );
}

export default function AdminDashboard() {
  // useSearchParams() must live inside a Suspense boundary in the
  // App Router so the page can still pre-render statically when the
  // query is unknown.
  return (
    <Suspense fallback={null}>
      <DashboardBody />
    </Suspense>
  );
}
