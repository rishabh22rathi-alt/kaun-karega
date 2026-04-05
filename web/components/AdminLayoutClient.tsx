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
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("Admin");
  const [role, setRole] = useState("admin");
  const [permissions, setPermissions] = useState<string[]>([]);
  const isLoginRoute = pathname === "/admin/login";
  const sidebarWidthClass = isDesktop ? (isSidebarCollapsed ? "md:ml-20" : "md:ml-72") : "";

  const redirectToLogin = () => {
    const nextPath =
      typeof window !== "undefined"
        ? `${window.location.pathname}${window.location.search}`
        : pathname || "/admin/dashboard";
    window.location.href = `/login?next=${encodeURIComponent(nextPath)}`;
  };

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
        redirectToLogin();
        return;
      }

      setName(typeof parsed.name === "string" && parsed.name ? parsed.name : "Admin");
      setRole(typeof parsed.role === "string" && parsed.role ? parsed.role : "admin");
      setPermissions(Array.isArray(parsed.permissions) ? (parsed.permissions as string[]) : []);
    } catch {
      redirectToLogin();
      return;
    } finally {
      setLoading(false);
    }
  }, [isLoginRoute, pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const applyLayoutState = (matches: boolean) => {
      setIsDesktop(matches);
      setIsSidebarCollapsed(!matches);
      setIsSidebarOpen(false);
    };

    applyLayoutState(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => applyLayoutState(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("kk_admin_session");
    document.cookie = "kk_auth_session=; Max-Age=0; Path=/; SameSite=Lax";
    document.cookie = "kk_admin=; Max-Age=0; Path=/; SameSite=Lax";
    redirectToLogin();
  };

  const handleSidebarToggle = () => {
    if (isDesktop) {
      setIsSidebarCollapsed((current) => !current);
      return;
    }
    setIsSidebarOpen((current) => !current);
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
        onMenuToggle={handleSidebarToggle}
        isSidebarCollapsed={isSidebarCollapsed}
        isDesktop={isDesktop}
      />

      <div className="flex min-h-[calc(100vh-4rem)] pt-16">
        <AdminSidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          permissions={permissions}
          isCollapsed={isSidebarCollapsed}
          isDesktop={isDesktop}
          onCollapseToggle={() => setIsSidebarCollapsed((current) => !current)}
        />
        <main className={`min-w-0 flex-1 overflow-x-auto p-4 transition-[margin] duration-200 md:p-6 xl:p-8 ${sidebarWidthClass}`}>
          <div className="mx-auto w-full max-w-none">{children}</div>
        </main>
      </div>
    </div>
  );
}
