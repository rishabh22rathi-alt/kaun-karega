"use client";

import Link from "next/link";
import { Inbox } from "lucide-react";

/**
 * User Alerts feed — v1 empty state.
 *
 * The user-targeted notification feed has no backend endpoint yet
 * (provider/admin pipelines pre-date this UI surface). Showing a quiet
 * empty state honours the "Alerts = inbox" semantic without faking
 * data. When a `/api/user/notifications` (or equivalent) ships, swap
 * this component for a `UserAlertsFeed` that mirrors
 * ProviderAlertsFeed.
 *
 * Carries a small inline link to /dashboard/notifications so users who
 * tap Alerts looking for control over notifications still have a
 * one-tap path to settings.
 */
export default function UserAlertsEmptyState() {
  return (
    <section
      data-testid="user-alerts-empty"
      className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm"
    >
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-100">
        <Inbox className="h-6 w-6 text-slate-400" aria-hidden="true" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-slate-900">
        No notifications yet
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-slate-600">
        When there&apos;s news about your requests, you&apos;ll see it here.
      </p>
      <div className="mt-5">
        <Link
          href="/dashboard/notifications"
          data-testid="user-alerts-settings-link"
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#003d20] underline-offset-2 hover:underline"
        >
          Adjust notification settings →
        </Link>
      </div>
    </section>
  );
}
