import type { ReactNode } from "react";
import Sidebar from "@/components/Sidebar";
import SidebarToggle from "@/components/SidebarToggle";

export default function ProviderLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex">
      <SidebarToggle />
      <Sidebar />
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
