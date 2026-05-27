import type { MetadataRoute } from "next";

/**
 * /robots.txt — served by Next from app/robots.ts.
 *
 * Phase 1-A indexability hygiene. Keeps Googlebot away from private /
 * session-only / one-shot / API surfaces while leaving the public
 * marketing & legal pages crawlable.
 *
 * Disallow patterns use Google's robots.txt prefix matching: a bare
 * "/admin" entry matches /admin AND every subpath. Trailing wildcards
 * (`/admin/*`) match subpaths only, so the bare form is preferred for
 * section roots.
 *
 * Sitemap reference is the only currently authoritative URL list — it
 * is the canonical way for Google to discover the homepage and the
 * legal pages without crawling the whole origin.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          // Logged-in / role-scoped surfaces.
          "/admin",
          "/dashboard",
          "/provider",
          "/user",
          "/my-tasks",
          // Auth flows — Googlebot following a /login?next=… chain
          // produces a sea of soft 404s otherwise.
          "/login",
          "/register",
          "/otp",
          "/verify",
          "/choose-role",
          // Task creation / I-Need flows — interactive, no public value.
          "/post-task",
          "/i-need/post",
          "/i-need/my-needs",
          // Chat surfaces — private threads, no public value.
          "/open-chat",
          "/chat",
          "/respond",
          // One-shot post-action pages — thin, transient.
          "/confirmation",
          "/success",
          "/report-issue",
          "/delete-account",
          "/data-deletion",
          // Infra — never index these even if they 200 for some reason.
          "/api/",
          "/_next/",
        ],
      },
    ],
    sitemap: "https://kaunkarega.com/sitemap.xml",
    host: "https://kaunkarega.com",
  };
}
