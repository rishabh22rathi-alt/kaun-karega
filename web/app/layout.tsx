import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import SidebarToggle from "@/components/SidebarToggle";
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
          style={{ "--kk-sidebar-width": "0px" } as React.CSSProperties}
        >
          <SidebarToggle />
          <Sidebar />
          <div className="min-h-screen min-w-0 flex-1 pt-14 transition-[padding] duration-200 md:pt-0 md:pl-[var(--kk-sidebar-width)]">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
