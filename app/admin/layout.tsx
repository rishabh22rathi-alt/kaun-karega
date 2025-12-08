"use client";

import { ReactNode, useEffect, useState } from "react";
import AdminSidebar from "@/components/AdminSidebar";
import AdminTopbar from "@/components/AdminTopbar";

type AdminLayoutProps = {
  children: ReactNode;
};

export default function AdminLayout({ children }: AdminLayoutProps) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Admin");
  const [role, setRole] = useState("admin");
  const [permissions, setPermissions] = useState<string[]>([]);

  useEffect(() => {
    try {
      const phone = localStorage.getItem("kk_phone");
      const storedRole = localStorage.getItem("kk_role");
      const storedName = localStorage.getItem("kk_name") || "Admin";
      const storedPermissions = JSON.parse(
        localStorage.getItem("kk_permissions") || "[]"
      );

      if (!phone || !storedRole || !Array.isArray(storedPermissions)) {
        window.location.href = "/admin/login";
        return;
      }

      if (storedRole !== "admin") {
        window.location.href = "/admin/login";
        return;
      }

      setName(storedName);
      setRole(storedRole);
      setPermissions(storedPermissions);
    } catch (err) {
      window.location.href = "/admin/login";
      return;
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("kk_phone");
    localStorage.removeItem("kk_role");
    localStorage.removeItem("kk_permissions");
    localStorage.removeItem("kk_name");
    window.location.href = "/admin/login";
  };

  if (loading) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top header bar */}
      <AdminTopbar
        name={name}
        role={role}
        onLogout={handleLogout}
        onMenuToggle={() => setIsSidebarOpen(true)}
      />

      <div className="flex pt-16">
        {/* Dark sidebar */}
        <AdminSidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          permissions={permissions}
        />

        {/* Page content */}
        <main className="flex-1 p-4 md:ml-72 md:p-8">{children}</main>
      </div>
    </div>
  );
}
