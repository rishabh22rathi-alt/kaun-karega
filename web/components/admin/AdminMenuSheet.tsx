"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  X,
  Megaphone,
  BarChart3,
  MessageSquareWarning,
  MessageSquare,
  Settings,
  Users,
  Tags,
  ScrollText,
  LineChart,
  Star,
  Activity,
  ListChecks,
  ExternalLink,
  LogOut,
  ChevronDown,
} from "lucide-react";
import InstallAppMenuRow from "../pwa/InstallAppMenuRow";

type Props = {
  open: boolean;
  onClose: () => void;
  name?: string;
  role?: string;
  permissions?: string[];
  onLogout: () => void | Promise<void>;
};

// I-Need feature is currently paused — mirror the gate the public
// Sidebar already uses. Flip when the feature relaunches.
const I_NEED_FEATURE_ACTIVE = false;

type RowProps = {
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClose: () => void;
  testId: string;
};

function SheetRow({ href, icon: Icon, label, onClose, testId }: RowProps) {
  return (
    <Link
      href={href}
      onClick={onClose}
      prefetch={false}
      data-testid={testId}
      className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-[#003d20] transition hover:bg-slate-100"
    >
      <Icon className="h-4 w-4 text-[#003d20]" />
      <span className="flex-1">{label}</span>
    </Link>
  );
}

export default function AdminMenuSheet({
  open,
  onClose,
  name,
  role,
  permissions,
  onLogout,
}: Props) {
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  const handleLogout = async () => {
    onClose();
    await Promise.resolve(onLogout());
  };

  if (!open) {
    return null;
  }

  const displayName = name && name.trim().length > 0 ? name : "Admin";
  const displayRole = role && role.trim().length > 0 ? role : "admin";
  const permissionChips = (permissions ?? []).filter(
    (perm) => typeof perm === "string" && perm.trim().length > 0
  );

  return (
    <>
      <div
        aria-hidden="true"
        onClick={onClose}
        data-testid="admin-menu-sheet-backdrop"
        className="fixed inset-0 z-[55] bg-slate-900/40 md:hidden"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Admin menu"
        data-testid="admin-menu-sheet"
        className="fixed inset-x-0 bottom-0 z-[55] flex max-h-[85vh] flex-col rounded-t-2xl bg-white shadow-[0_-20px_60px_rgba(15,23,42,0.18)] md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-bold text-[#003d20]">Admin Menu</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close admin menu"
            data-testid="admin-menu-close"
            className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-[#003d20]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Identity card */}
          <div className="border-b border-slate-100 px-4 py-4">
            <p
              className="text-sm font-semibold text-[#003d20]"
              data-testid="admin-menu-identity-name"
            >
              {displayName}
            </p>
            <p
              className="mt-0.5 text-xs uppercase tracking-wide text-slate-500"
              data-testid="admin-menu-identity-role"
            >
              {displayRole}
            </p>
            {permissionChips.length > 0 ? (
              <div
                className="mt-2 flex flex-wrap gap-1"
                data-testid="admin-menu-identity-permissions"
              >
                {permissionChips.map((perm) => (
                  <span
                    key={perm}
                    className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] font-semibold text-slate-700"
                  >
                    {perm}
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {/* Operations */}
          <div className="border-b border-slate-100 px-2 py-2">
            <p className="px-3 pb-1 pt-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">
              Operations
            </p>
            <SheetRow
              href="/admin/announcements"
              icon={Megaphone}
              label="Announcements"
              onClose={onClose}
              testId="admin-menu-announcements"
            />
            <SheetRow
              href="/admin/dashboard?tab=notifications"
              icon={BarChart3}
              label="Notification Analytics"
              onClose={onClose}
              testId="admin-menu-notification-analytics"
            />
            <SheetRow
              href="/admin/notifications"
              icon={Settings}
              label="Notification Settings"
              onClose={onClose}
              testId="admin-menu-notification-settings"
            />
            <SheetRow
              href="/admin/dashboard?tab=reports"
              icon={MessageSquareWarning}
              label="Reports"
              onClose={onClose}
              testId="admin-menu-reports"
            />
            <SheetRow
              href="/admin/dashboard?tab=chats"
              icon={MessageSquare}
              label="Chats"
              onClose={onClose}
              testId="admin-menu-chats"
            />
            {/* Phase 2 PWA — install entry point for admins too.
                Self-hides ONLY while the current page is rendered
                as a standalone PWA (display-mode standalone /
                fullscreen / minimal-ui, or navigator.standalone on
                iOS). Persisted `kk_pwa_installed` does NOT hide
                this row — admins in a browser tab keep the manual
                install entry even after a prior install. */}
            <InstallAppMenuRow onClose={onClose} />
          </div>

          {/* More tools — collapsed by default */}
          <div className="border-b border-slate-100 px-2 py-2">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              aria-controls="admin-menu-more-tools"
              data-testid="admin-menu-more-toggle"
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-slate-500 transition hover:text-[#003d20]"
            >
              <span>More tools</span>
              <ChevronDown
                aria-hidden="true"
                className={`ml-auto h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                  moreOpen ? "rotate-0" : "-rotate-90"
                }`}
              />
            </button>
            {moreOpen ? (
              <div id="admin-menu-more-tools">
                <SheetRow
                  href="/admin/team"
                  icon={Users}
                  label="Team"
                  onClose={onClose}
                  testId="admin-menu-team"
                />
                <SheetRow
                  href="/admin/aliases"
                  icon={Tags}
                  label="Aliases"
                  onClose={onClose}
                  testId="admin-menu-aliases"
                />
                <SheetRow
                  href="/admin/logs"
                  icon={ScrollText}
                  label="System Logs"
                  onClose={onClose}
                  testId="admin-menu-logs"
                />
                <SheetRow
                  href="/admin/analytics"
                  icon={LineChart}
                  label="Analytics"
                  onClose={onClose}
                  testId="admin-menu-analytics"
                />
                <SheetRow
                  href="/admin/reviews"
                  icon={Star}
                  label="Reviews"
                  onClose={onClose}
                  testId="admin-menu-reviews"
                />
                <SheetRow
                  href="/admin/task-monitor"
                  icon={Activity}
                  label="Task Monitor"
                  onClose={onClose}
                  testId="admin-menu-task-monitor"
                />
                {I_NEED_FEATURE_ACTIVE ? (
                  <SheetRow
                    href="/admin/needs"
                    icon={ListChecks}
                    label="Needs"
                    onClose={onClose}
                    testId="admin-menu-needs"
                  />
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Context */}
          <div className="border-b border-slate-100 px-2 py-2">
            <SheetRow
              href="/"
              icon={ExternalLink}
              label="Open user view"
              onClose={onClose}
              testId="admin-menu-user-view"
            />
          </div>

          {/* Destructive */}
          <div className="px-2 py-2">
            <button
              type="button"
              onClick={() => void handleLogout()}
              data-testid="admin-menu-logout"
              className="flex w-full items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold text-red-600 transition hover:bg-red-50"
            >
              <LogOut className="h-4 w-4 text-red-600" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
