import type { ReactNode } from "react";
import dynamic from "next/dynamic";

const SidebarToggle = dynamic(() => import("@/components/SidebarToggle"));

export default function ProviderLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex">
      <SidebarToggle />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
