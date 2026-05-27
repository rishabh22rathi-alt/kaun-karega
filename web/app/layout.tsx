import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import GlobalProviderNotificationBell from "@/components/GlobalProviderNotificationBell";
import MobileBottomNav from "@/components/MobileBottomNav";
import SessionGuardMount from "@/components/SessionGuardMount";
import PwaServiceWorkerRegister from "@/components/PwaServiceWorkerRegister";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// SEO Phase 1-A — production canonical origin. All `openGraph.url`,
// `alternates.canonical`, image src resolution, and the manifest URL
// resolve against this base. Must be the live HTTPS origin (not the
// dev URL) so previews and crawlers receive absolute kaunkarega.com
// links rather than localhost:3000 references.
const SITE_URL = "https://kaunkarega.com";
const SITE_NAME = "Kaun Karega";
const SITE_DESCRIPTION =
  "Find trusted local service providers in Jodhpur — electricians, plumbers, carpenters, AC technicians and more. Post your task and get connected to nearby providers on WhatsApp instantly.";
const SITE_OG_IMAGE = "/icons/icon-512-v2.png";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    // `default` is used for the homepage and any page that does not
    // export its own metadata.title. `template` is applied when a
    // child page exports just a string title (e.g. "Privacy" becomes
    // "Privacy | Kaun Karega").
    default: `${SITE_NAME} — Find Local Service Providers in Jodhpur`,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  // Default canonical points at the origin root. Per-page metadata
  // SHOULD override this with its own canonical to prevent duplicate-
  // content issues across query-string variants of the homepage.
  alternates: {
    canonical: "/",
  },
  // Default robots posture: public pages may be indexed and links
  // followed. Private routes (admin, dashboard, provider, etc.) layer
  // their own `robots: { index: false }` on top via layout metadata,
  // and the parallel `app/robots.ts` declares the Disallow list.
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "en_IN",
    title: `${SITE_NAME} — Find Local Service Providers in Jodhpur`,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: SITE_OG_IMAGE,
        width: 512,
        height: 512,
        alt: `${SITE_NAME} logo`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — Find Local Service Providers in Jodhpur`,
    description: SITE_DESCRIPTION,
    images: [SITE_OG_IMAGE],
  },
  // Manifest is served at /manifest.webmanifest by Next from
  // app/manifest.ts. Without this `manifest` field, Next does not
  // emit the <link rel="manifest"> tag and the browser cannot
  // satisfy the PWA install gate.
  manifest: "/manifest.webmanifest",
  // iOS Safari "Add to Home Screen" support. Standalone mode +
  // status-bar style + home-screen label.
  appleWebApp: {
    capable: true,
    title: SITE_NAME,
    statusBarStyle: "default",
  },
  verification: {
    google: "cby0V9TmJBPIdjWBLuxJhXeOG9QWsKYfMJtddlnuFy0",
  },
};

// SEO Phase 1-A — Organization + WebSite JSON-LD. Inlined as a single
// @graph payload so Google parses both entities in one read and links
// the WebSite to the Organization via @id reference.
//
// `sameAs` is intentionally omitted — populate with social profile
// URLs (Instagram, Facebook, LinkedIn) once those accounts exist and
// are verifiably owned. Surfacing the wrong URL here misleads the
// knowledge panel.
//
// No SearchAction is declared on the WebSite node — the homepage's
// site-internal search is interactive (client component) and does
// not yet have a stable GET URL pattern. Add when /search?q=… exists.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      url: SITE_URL,
      logo: `${SITE_URL}${SITE_OG_IMAGE}`,
      description: SITE_DESCRIPTION,
      areaServed: {
        "@type": "City",
        name: "Jodhpur",
        containedInPlace: {
          "@type": "State",
          name: "Rajasthan",
        },
      },
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      description: SITE_DESCRIPTION,
      inLanguage: "en-IN",
      publisher: { "@id": `${SITE_URL}/#organization` },
    },
  ],
};

// Theme color must live on the `viewport` export in Next 15+ (Next 16
// included). Setting it here publishes the <meta name="theme-color">
// tag so the Android Chrome address bar / system status bar tints
// match the brand forest green.
export const viewport: Viewport = {
  themeColor: "#003d20",
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
        {/* SEO Phase 1-A — Organization + WebSite JSON-LD. Inlined as a
            raw <script type="application/ld+json"> rather than next/script
            so it appears in the initial server HTML (Googlebot reads
            JSON-LD on first render; deferred scripts are skipped). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }}
        />
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
          {/* PWA Phase 1 — registers /sw.js in production only. The
              service worker is intentionally pass-through (no caching);
              this component only exists to satisfy Chrome's
              installability gate. Renders nothing. */}
          <PwaServiceWorkerRegister />
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
