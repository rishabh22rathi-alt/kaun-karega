"use client";

import { SIDEBAR_TOGGLE_EVENT } from "./sidebarEvents";

export default function SidebarToggle() {
  const handleClick = () => {
    if (typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent(SIDEBAR_TOGGLE_EVENT, { detail: { type: "toggle" } })
    );
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="md:hidden fixed top-4 left-4 z-50 inline-flex flex-col gap-1 rounded-full bg-white/90 px-3 py-2 shadow-md border border-white/70"
      aria-label="Toggle sidebar"
    >
      <span className="block h-0.5 w-5 bg-[#111827]" />
      <span className="block h-0.5 w-5 bg-[#111827]" />
      <span className="block h-0.5 w-5 bg-[#111827]" />
    </button>
  );
}
