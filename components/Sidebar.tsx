"use client";

"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  CheckCircle,
  BarChart2,
  type LucideIcon,
  Home,
  LogIn,
} from "lucide-react";
import { SIDEBAR_TOGGLE_EVENT } from "./sidebarEvents";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
};

const navItems: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: Home },
  { label: "Requests Received", href: "/requests", icon: Inbox },
  { label: "Requests Responded", href: "/responded", icon: CheckCircle },
  { label: "Monthly Analytics", href: "/analytics", icon: BarChart2 },
  { label: "Login / Register", href: "/login", icon: LogIn },
];

export default function Sidebar() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handler = () => setIsOpen((prev) => !prev);
    window.addEventListener(SIDEBAR_TOGGLE_EVENT, handler);
    return () => window.removeEventListener(SIDEBAR_TOGGLE_EVENT, handler);
  }, []);

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={`fixed inset-0 bg-black/40 transition-opacity md:hidden ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={() => setIsOpen(false)}
      />

      <aside
        className={`fixed top-0 left-0 z-40 h-full w-64 bg-[#003d20] text-white shadow-lg transition-transform duration-300 md:translate-x-0 md:flex md:flex-col ${
          isOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
        }`}
      >
        <div className="px-5 py-6 border-b border-white/10">
          <p className="text-lg font-extrabold text-white">Kaun Karega</p>
          <p className="text-sm text-white/80">Provider Panel</p>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-2">
          {navItems.map((item) => {
            const active = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 font-semibold text-white transition ${
                  active
                    ? "bg-white/20 text-white shadow-sm"
                    : "hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="h-5 w-5" />
                <span className="text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

