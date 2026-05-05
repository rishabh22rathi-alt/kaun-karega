import { redirect } from "next/navigation";

// Public pause for /i-need/chat/[threadId]. The full chat-thread
// implementation is preserved at the sibling page.tsx.bak — restore by
// renaming back to page.tsx. need_chat_send_message / need_chat_get_messages
// / need_chat_mark_read intercepts stay live so existing threads in
// Supabase are untouched.
export default function INeedChatPaused() {
  redirect("/i-need");
}
