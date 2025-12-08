"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type AdminSidebarProps = {
  isOpen: boolean;
  onClose?: () => void;
  permissions: string[];
};

type NavItem = {
  label: string;
  href: string;
  icon: JSX.Element;
  requiredPermission?: string;
};

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/admin/dashboard",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0h6"
        />
      </svg>
    ),
  },
  {
    label: "Providers",
    href: "/admin",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M17 20h5v-2a4 4 0 00-4-4h-1m0 6H7m10 0v-2a4 4 0 00-4-4H9a4 4 0 00-4 4v2m0 0H1v-2a4 4 0 014-4h1m8-5a4 4 0 11-8 0 4 4 0 018 0zm6 0a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
  {
    label: "Tasks",
    href: "/admin/tasks",
    requiredPermission: "view_tasks",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M9 12h6m-6 4h6m-7 4h8a2 2 0 002-2V6a2 2 0 00-2-2H7a2 2 0 00-2 2v12a2 2 0 002 2zM9 8h6"
        />
      </svg>
    ),
  },
  {
    label: "Chat Rooms",
    href: "/admin/chats",
    requiredPermission: "view_chats",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M7 8h10M7 12h6m-2 8l-4 2v-2H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v10a2 2 0 01-2 2H9z"
        />
      </svg>
    ),
  },
  {
    label: "Logs",
    href: "/admin/logs",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M12 8v4l2.5 2.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      </svg>
    ),
  },
  {
    label: "Reviews",
    href: "/admin/reviews",
    requiredPermission: "view_reviews",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M12 17l-4.5 2.4.9-5.2-3.8-3.7 5.3-.8L12 5l2.1 4.7 5.3.8-3.8 3.7.9 5.2z"
        />
      </svg>
    ),
  },
  {
    label: "Community",
    href: "/admin/community",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M12 12a3 3 0 100-6 3 3 0 000 6zm0 0v6m0 0c-3 0-6-1-6-4m6 4c3 0 6-1 6-4"
        />
      </svg>
    ),
  },
  {
    label: "Team Members",
    href: "/admin/team",
    icon: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
          d="M16 11c1.657 0 3-1.79 3-4s-1.343-4-3-4-3 1.79-3 4 1.343 4 3 4zM8 11c1.657 0 3-1.79 3-4S9.657 3 8 3 5 4.79 5 7s1.343 4 3 4zm0 2c-2.21 0-4 1.343-4 3v3h8v-3c0-1.657-1.79-3-4-3zm8 0c-.34 0-.67.03-.99.086A4.486 4.486 0 0120 17v3h-6v-3c0-1.343.81-2.5 2-2.914"
        />
      </svg>
    ),
  },
];

export default function AdminSidebar({
  isOpen,
  onClose,
  permissions,
}: AdminSidebarProps) {
  const pathname = usePathname();

  const visibleItems = navItems.filter((item) => {
    if (item.requiredPermission) {
      return permissions.includes(item.requiredPermission);
    }
    return true;
  });

  return (
    <>
      <div
        className={`fixed inset-0 bg-black/40 transition-opacity md:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={onClose}
      />
      <aside
        className={`fixed top-0 left-0 z-40 flex h-full w-72 flex-col bg-slate-900 text-slate-100 shadow-2xl transition-transform duration-300 md:translate-x-0 ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="border-b border-white/10 px-5 py-6">
          <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
            Kaun Karega
          </p>
          <p className="text-xl font-semibold text-white">Admin Control</p>
          <p className="text-sm text-slate-400">Manage providers & tasks</p>
        </div>

        <nav className="flex-1 space-y-1 px-3 py-4">
          {visibleItems.map((item) => {
            const active =
              item.href === "/admin"
                ? pathname === "/admin"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active
                    ? "bg-white/10 text-white shadow-sm ring-1 ring-white/10"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span
                  className={`flex h-9 w-9 items-center justify-center rounded-lg border ${
                    active
                      ? "border-white/20 bg-white/10 text-white"
                      : "border-white/10 bg-white/5 text-slate-200"
                  }`}
                >
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
