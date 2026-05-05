import { redirect } from "next/navigation";

// Public pause for /i-need/respond/[needId]. The full implementation is
// preserved at the sibling page.tsx.bak — restore by renaming back to
// page.tsx. need_chat_create_or_get_thread intercept stays live for
// backend reuse.
export default function RespondToNeedPaused() {
  redirect("/i-need");
}
