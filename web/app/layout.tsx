import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import SidebarToggle from "@/components/SidebarToggle";
import GlobalProviderNotificationBell from "@/components/GlobalProviderNotificationBell";
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
            "--kk-mobile-header-height": "60px",
          } as React.CSSProperties}
        >
          <SidebarToggle />
          <Sidebar />
          {/*
            Global notification bell — fixed to the viewport, aligned to the
            content area's right edge via the inner max-w-6xl track. z-[60]
            sits above the mobile SidebarToggle (z-50) so the bell stays
            visible whether the sidebar is open or closed. Pointer events
            pass through the wrapper so the rest of the page stays
            interactive everywhere except the bell. The component itself
            self-hides for guests, non-providers, and admin routes.
          */}
          <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] md:top-5">
            <div className="pointer-events-none mx-auto flex w-full max-w-6xl justify-end px-4 md:px-6">
              <div className="pointer-events-auto">
                <GlobalProviderNotificationBell />
              </div>
            </div>
          </div>
          <div className="min-h-screen min-w-0 flex-1 pt-[var(--kk-mobile-header-height)] transition-[padding] duration-200 md:pt-0 md:pl-[var(--kk-sidebar-width)]">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
