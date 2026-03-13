"use client";

import { useEffect, useState } from "react";
import { SIDEBAR_STATE_EVENT, SIDEBAR_TOGGLE_EVENT } from "./sidebarEvents";

export default function SidebarToggle() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateIsMobile = () => {
      const isDesktop = window.matchMedia("(min-width: 768px)").matches;
      setIsMobile(!isDesktop);
    };
    updateIsMobile();
    window.addEventListener("resize", updateIsMobile);
    return () => window.removeEventListener("resize", updateIsMobile);
  }, []);

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
    window.dispatchEvent(new CustomEvent(SIDEBAR_TOGGLE_EVENT));
  };

  if (!isMobile || isSidebarOpen) {
    return null;
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="fixed top-4 left-4 z-50 inline-flex flex-col gap-1 rounded-full bg-white/90 px-3 py-2 shadow-md border border-white/70"
      aria-label="Open menu"
    >
      <span className="block h-0.5 w-5 bg-[#111827]" />
      <span className="block h-0.5 w-5 bg-[#111827]" />
      <span className="block h-0.5 w-5 bg-[#111827]" />
    </button>
  );
}
