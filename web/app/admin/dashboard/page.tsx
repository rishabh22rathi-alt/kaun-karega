"use client";

import ProvidersTab from "@/components/admin/ProvidersTab";
import CategoryTab from "@/components/admin/CategoryTab";
import AreaTab from "@/components/admin/AreaTab";

/**
 * /admin/dashboard — fresh workspace.
 *
 * Auth, sidebar, topbar, and the responsive shell are all owned by
 * AdminLayoutClient (web/components/AdminLayoutClient.tsx) which wraps
 * every /admin route via web/app/admin/layout.tsx. This page only owns
 * the inner content slot — append new collapsible tabs below.
 */

export default function AdminDashboard() {
  return (
    <div className="min-w-0 space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Admin Dashboard</h1>
        <p className="mt-1 text-slate-600">
          Build and manage Kaun Karega operations from one place.
        </p>
      </div>

      <ProvidersTab />
      <CategoryTab />
      <AreaTab />
    </div>
  );
}
