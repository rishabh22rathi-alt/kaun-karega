import type { ReactNode } from "react";
import dynamic from "next/dynamic";

const Sidebar = dynamic(() => import("@/components/Sidebar"));
const SidebarToggle = dynamic(() => import("@/components/SidebarToggle"));

export default function ProviderLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex">
      <SidebarToggle />
      <Sidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
