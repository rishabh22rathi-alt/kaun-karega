import type { ReactNode } from "react";
import type { Metadata } from "next";
import dynamic from "next/dynamic";

const AdminLayoutClient = dynamic(() => import("@/components/AdminLayoutClient"));

// SEO Phase 1-A — keep /admin and every /admin/* subroute out of
// Google's index. Belt-and-braces with the Disallow rule in
// app/robots.ts: this metadata emits a <meta name="robots"
// content="noindex,nofollow"> so URLs already discovered by Google
// (via inbound links, pre-existing sitemaps, or a curious crawler)
// are dropped on the next refetch.
export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

type AdminLayoutProps = {
  children: ReactNode;
};

export default function AdminLayout({ children }: AdminLayoutProps) {
  return <AdminLayoutClient>{children}</AdminLayoutClient>;
}
