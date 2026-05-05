import { redirect } from "next/navigation";

// Public pause for /i-need/post. The full form implementation is preserved
// at app/i-need/post/page.tsx.bak — restore by renaming back to page.tsx.
// All backend routes (/api/kk action="create_need" etc.) remain live so
// admin/diagnostic flows still work; only the public form is paused.
export default function PostNeedPaused() {
  redirect("/i-need");
}
