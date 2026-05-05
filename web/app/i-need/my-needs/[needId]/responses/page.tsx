import { redirect } from "next/navigation";

// Public pause for /i-need/my-needs/[needId]/responses. The full
// implementation is preserved at the sibling page.tsx.bak — restore by
// renaming back to page.tsx. The /api/kk need_chat_get_threads_for_need
// intercept stays live for backend reuse.
export default function MyNeedResponsesPaused() {
  redirect("/i-need");
}
