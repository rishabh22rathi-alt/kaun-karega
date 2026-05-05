import { redirect } from "next/navigation";

// Public pause for /i-need/my-needs. The full implementation is preserved
// at app/i-need/my-needs/page.tsx.bak — restore by renaming back to page.tsx.
// Need data and chat unread counts in Supabase are untouched.
export default function MyNeedsPaused() {
  redirect("/i-need");
}
