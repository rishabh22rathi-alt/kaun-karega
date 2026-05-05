import { redirect } from "next/navigation";

// Legacy task-posting page. The active flow is the homepage form which posts
// to /api/submit-request. This page used to call /api/save-task (Apps Script
// path) and bypassed Supabase entirely. Permanently redirect to the homepage
// so any deep link, sitemap, or cached SMS link funnels into the live flow.
export default function PostTaskRedirect() {
  redirect("/");
}
