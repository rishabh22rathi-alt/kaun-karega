"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

const AdminSidebar = dynamic(() => import("@/components/AdminSidebar"), {
  ssr: false,
});
const AdminTopbar = dynamic(() => import("@/components/AdminTopbar"), {
  ssr: false,
});

type AdminLayoutClientProps = {
  children: React.ReactNode;
};

type AdminSessionData = {
  isAdmin?: unknown;
  name?: unknown;
  role?: unknown;
  permissions?: unknown;
};

function applySessionData(
  parsed: AdminSessionData,
  setName: (v: string) => void,
  setRole: (v: string) => void,
  setPermissions: (v: string[]) => void
) {
  setName(typeof parsed.name === "string" && parsed.name ? parsed.name : "Admin");
  setRole(typeof parsed.role === "string" && parsed.role ? parsed.role : "admin");
  setPermissions(Array.isArray(parsed.permissions) ? (parsed.permissions as string[]) : []);
}

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

    // Fast path: valid session in localStorage
    try {
      const raw = localStorage.getItem("kk_admin_session");
      const parsed = raw ? (JSON.parse(raw) as AdminSessionData) : null;
      if (parsed?.isAdmin === true) {
        applySessionData(parsed, setName, setRole, setPermissions);
        setLoading(false);
        return;
      }
    } catch {
      // localStorage corrupt — fall through to API recovery below
    }

    // Recovery path: localStorage missing or invalid, but cookies may still be valid.
    // Try to re-verify using the auth session cookie to avoid a full OTP re-login.
    const cookieSession = getAuthSession();
    if (!cookieSession?.phone) {
      setLoading(false);
      redirectToLogin();
      return;
    }

    fetch("/api/admin-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: cookieSession.phone }),
    })
      .then((r) => r.json() as Promise<{ ok?: boolean; admin?: AdminSessionData }>)
      .then((data) => {
        if (data?.ok && data.admin) {
          const sessionData: AdminSessionData = { isAdmin: true, ...data.admin };
          try {
            localStorage.setItem("kk_admin_session", JSON.stringify(sessionData));
          } catch {
            // ignore storage errors
          }
          applySessionData(sessionData, setName, setRole, setPermissions);
        } else {
          redirectToLogin();
        }
      })
      .catch(() => redirectToLogin())
      .finally(() => setLoading(false));
  }, [isLoginRoute, pathname]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const applyLayoutState = (matches: boolean) => {
      setIsDesktop(matches);
      // Only collapse on desktop; mobile sidebar is always full-width when open
      setIsSidebarCollapsed(false);
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
      <div className="flex min-h-screen">
        <AdminSidebar
          isOpen={isSidebarOpen}
          onClose={() => setIsSidebarOpen(false)}
          permissions={permissions}
          isCollapsed={isDesktop && isSidebarCollapsed}
          isDesktop={isDesktop}
          onCollapseToggle={() => setIsSidebarCollapsed((current) => !current)}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <AdminTopbar
            name={name}
            role={role}
            onLogout={handleLogout}
            onMenuToggle={handleSidebarToggle}
            isSidebarCollapsed={isSidebarCollapsed}
            isDesktop={isDesktop}
          />

          <main className="min-w-0 flex-1 overflow-x-auto p-4 md:p-6 xl:p-8">
            <div className="mx-auto w-full max-w-none">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
