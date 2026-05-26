import type { MetadataRoute } from "next";

/**
 * Web App Manifest — served at /manifest.webmanifest by Next.js.
 *
 * Phase 1 installability foundation. Enables "Install app" on Android
 * Chrome and "Add to Home Screen" on iOS Safari. No install prompt UI
 * yet — that ships in Phase 2.
 *
 * theme_color: brand forest green; also published as a <meta name
 * ="theme-color"> via the viewport export in app/layout.tsx so the
 * Android status bar matches the brand.
 *
 * background_color: white. Shown briefly during the PWA splash before
 * the app's first paint. White keeps the splash neutral; the in-app
 * homepage controls its own gradient.
 *
 * Three icons:
 *   - 192x192 any-purpose
 *   - 512x512 any-purpose
 *   - 512x512 maskable (content kept inside the inner 80% safe zone
 *     so Android adaptive icons crop cleanly to circle/squircle).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kaun Karega",
    short_name: "Kaun Karega",
    description:
      "Find trusted local service providers for any work. Post your task and get connected instantly.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#003d20",
    lang: "en",
    dir: "ltr",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
