"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

const AdminSidebar = dynamic(() => import("@/components/AdminSidebar"), {
  ssr: false,
});
const AdminTopbar = dynamic(() => import("@/components/AdminTopbar"), {
  ssr: false,
});

type AdminLayoutClientProps = {
  children: React.ReactNode;
};

export default function AdminLayoutClient({
  children,
}: AdminLayoutClientProps) {
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
      <AdminTopbar
        name={name}
        role={role}
        onLogout={handleLogout}
        onMenuToggle={() => setIsSidebarOpen(true)}
      />

      <div className="flex pt-16">
        <AdminSidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          permissions={permissions}
        />
        <main className="flex-1 p-4 md:ml-72 md:p-8">{children}</main>
      </div>
    </div>
  );
}
