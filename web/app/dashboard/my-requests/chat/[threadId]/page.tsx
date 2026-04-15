import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ threadId: string }>;
};

export default async function OldUserRequestChatPage({ params }: Props) {
  const { threadId } = await params;
  const safe = encodeURIComponent(String(threadId || "").trim());
  if (!safe) redirect("/dashboard/my-requests");
  redirect(`/chat/thread/${safe}?actor=user`);
}
