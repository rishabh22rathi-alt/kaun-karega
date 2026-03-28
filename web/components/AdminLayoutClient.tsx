"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

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
  const pathname = usePathname();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Admin");
  const [role, setRole] = useState("admin");
  const [permissions, setPermissions] = useState<string[]>([]);
  const isLoginRoute = pathname === "/admin/login";

  useEffect(() => {
    if (isLoginRoute) {
      setLoading(false);
      return;
    }

    try {
      const raw = localStorage.getItem("kk_admin_session");
      const parsed = raw
        ? (JSON.parse(raw) as {
            isAdmin?: unknown;
            name?: unknown;
            role?: unknown;
            permissions?: unknown;
          })
        : null;

      if (parsed?.isAdmin !== true) {
        window.location.href = "/otp?next=/admin/dashboard";
        return;
      }

      setName(typeof parsed.name === "string" && parsed.name ? parsed.name : "Admin");
      setRole(typeof parsed.role === "string" && parsed.role ? parsed.role : "admin");
      setPermissions(Array.isArray(parsed.permissions) ? (parsed.permissions as string[]) : []);
    } catch {
      window.location.href = "/otp?next=/admin/dashboard";
      return;
    } finally {
      setLoading(false);
    }
  }, [isLoginRoute]);

  const handleLogout = () => {
    localStorage.removeItem("kk_admin_session");
    document.cookie = "kk_auth_session=; Max-Age=0; Path=/; SameSite=Lax";
    document.cookie = "kk_admin=; Max-Age=0; Path=/; SameSite=Lax";
    window.location.href = "/otp?next=/admin/dashboard";
  };

  if (loading) {
    return null;
  }

  if (isLoginRoute) {
    return <>{children}</>;
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
