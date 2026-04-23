import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { getProviderByPhoneFromSupabase } from "@/lib/admin/adminProviderReads";
import { getChatThreadsFromSupabase } from "@/lib/chat/chatPersistence";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizePhone10(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

export default async function OpenChatPage() {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore
    .getAll()
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join("; ");
  const session = getAuthSession({ cookie: cookieHeader });
  const sessionPhone = normalizePhone10(String(session?.phone || ""));

  if (!sessionPhone) {
    redirect(`/login?next=${encodeURIComponent("/open-chat")}`);
  }

  let actorType: "user" | "provider" = "user";

  try {
    const providerLookup = await getProviderByPhoneFromSupabase(sessionPhone);
    if (providerLookup.ok === true) {
      actorType = "provider";
    }
  } catch {
    actorType = "user";
  }

  try {
    const threadsPayload = await getChatThreadsFromSupabase(
      actorType === "provider"
        ? { ActorType: "provider", loggedInProviderPhone: sessionPhone }
        : { ActorType: "user", UserPhone: sessionPhone }
    );

    if (threadsPayload.ok && Array.isArray(threadsPayload.threads)) {
      const threadId = String(threadsPayload.threads[0]?.ThreadID || "").trim();
      if (threadId) {
        redirect(
          actorType === "user"
            ? `/chat/thread/${encodeURIComponent(threadId)}?actor=user`
            : `/chat/thread/${encodeURIComponent(threadId)}`
        );
      }
    }
  } catch {}

  redirect(actorType === "provider" ? "/provider/dashboard" : "/dashboard/my-requests");
}
