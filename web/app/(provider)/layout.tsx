import type { ReactNode } from "react";
import type { Metadata } from "next";

// SEO Phase 1-A — provider workspace pages (route-group siblings:
// /analytics, /provider-dashboard, /requests, /responded) are
// session-only and have no SEO value. The robots.txt Disallow on
// /provider covers the namespaced /provider/* routes; this metadata
// covers the top-level group routes that share this layout.
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

export default function ProviderLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex">
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
