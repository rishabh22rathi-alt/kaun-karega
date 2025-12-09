import type { ReactNode } from "react";
import dynamic from "next/dynamic";

const AdminLayoutClient = dynamic(() => import("@/components/AdminLayoutClient"));

type AdminLayoutProps = {
  children: ReactNode;
};

export default function AdminLayout({ children }: AdminLayoutProps) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
