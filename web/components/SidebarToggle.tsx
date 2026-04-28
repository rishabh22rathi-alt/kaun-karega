"use client";

import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { SIDEBAR_STATE_EVENT, SIDEBAR_TOGGLE_EVENT } from "./sidebarEvents";

export default function SidebarToggle() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const pathname = usePathname();

  const shouldHide = pathname?.startsWith("/admin");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ isOpen?: boolean }>).detail;
      setIsSidebarOpen(Boolean(detail?.isOpen));
    };
    window.addEventListener(SIDEBAR_STATE_EVENT, handler);
    return () => window.removeEventListener(SIDEBAR_STATE_EVENT, handler);
  }, []);

  const handleClick = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_TOGGLE_EVENT, {
        detail: { open: true },
      })
    );
  };

  if (shouldHide || isSidebarOpen) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-50 border-b border-slate-200 bg-white/95 pt-3 shadow-sm backdrop-blur md:hidden md:pt-0">
      <div className="flex h-14 items-center px-3">
        <button
          type="button"
          onClick={handleClick}
          aria-label="Open menu"
          aria-expanded={false}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-[#003d20] text-white shadow-sm transition hover:bg-[#00542b] focus:outline-none focus:ring-2 focus:ring-[#003d20]/30"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>
    </div>
  );
}
