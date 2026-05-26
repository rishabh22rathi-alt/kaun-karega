import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import GlobalProviderNotificationBell from "@/components/GlobalProviderNotificationBell";
import MobileBottomNav from "@/components/MobileBottomNav";
import SessionGuardMount from "@/components/SessionGuardMount";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Kaun Karega",
  description: "Find trusted local service providers for any work. Post your task and get connected instantly.",
  verification: {
    google: "cby0V9TmJBPIdjWBLuxJhXeOG9QWsKYfMJtddlnuFy0",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased overflow-x-hidden`}
      >
        <div
          id="kk-app-shell"
          className="flex min-h-screen"
          style={{
            "--kk-sidebar-width": "0px",
            "--kk-mobile-header-height": "0px",
            "--kk-bottom-nav-height": "0px",
          } as React.CSSProperties}
        >
          {/* SessionGuardMount used to live inside Sidebar; pulled out so the
              stale-session probe still runs on mobile, where the sidebar is
              hidden (`hidden md:flex`). */}
          <SessionGuardMount />
          <Sidebar />
          {/*
            Global notification bell — desktop only. On mobile the bottom-nav
            Notifications/Alerts tab is the access point and the bell would
            duplicate visual chrome at the top. The wrapper's `hidden md:block`
            also prevents the bell component from mounting on mobile, so its
            polling does not duplicate the bottom-nav's provider-unread poll.
          */}
          <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] hidden pt-[max(env(safe-area-inset-top),1.5rem)] md:block md:pt-[max(env(safe-area-inset-top),1.25rem)]">
            <div className="pointer-events-none mx-auto flex w-full max-w-6xl justify-end px-4 md:px-6">
              <div className="pointer-events-auto">
                <GlobalProviderNotificationBell />
              </div>
            </div>
          </div>
          <div className="min-h-screen min-w-0 flex-1 pt-[var(--kk-mobile-header-height)] pb-[var(--kk-bottom-nav-height)] transition-[padding] duration-200 md:pt-0 md:pb-0 md:pl-[var(--kk-sidebar-width)]">
            {children}
          </div>
          <MobileBottomNav />
        </div>
      </body>
    </html>
  );
}
