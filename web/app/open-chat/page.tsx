import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

type ProviderLookupResponse = {
  ok?: boolean;
  provider?: {
    ProviderID?: string;
    Phone?: string;
  };
};

type ChatThread = {
  ThreadID?: string;
  LastMessageAt?: string;
  UpdatedAt?: string;
  CreatedAt?: string;
};

type ChatThreadsResponse = {
  ok?: boolean;
  threads?: ChatThread[];
};

function normalizePhone10(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

async function fetchAppsScriptJson(payload: Record<string, unknown>) {
  if (!APPS_SCRIPT_URL) {
    throw new Error("APPS_SCRIPT_URL is not configured");
  }

  const response = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  let data: unknown = {};

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }

  return {
    ok: response.ok,
    data,
  };
}

async function lookupProviderByPhone(phone10: string): Promise<ProviderLookupResponse | null> {
  const result = await fetchAppsScriptJson({
    action: "get_provider_by_phone",
    phone: phone10,
  });

  if (!result.ok || !result.data || typeof result.data !== "object") {
    return null;
  }

  return result.data as ProviderLookupResponse;
}

async function lookupThreads(actorType: "user" | "provider", phone10: string): Promise<ChatThread[]> {
  const result = await fetchAppsScriptJson(
    actorType === "provider"
      ? {
          action: "chat_get_threads",
          ActorType: "provider",
          loggedInProviderPhone: phone10,
        }
      : {
          action: "chat_get_threads",
          ActorType: "user",
          UserPhone: phone10,
        }
  );

  if (!result.ok || !result.data || typeof result.data !== "object") {
    return [];
  }

  const payload = result.data as ChatThreadsResponse;
  return Array.isArray(payload.threads) ? payload.threads : [];
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
    const providerLookup = await lookupProviderByPhone(sessionPhone);
    if (providerLookup?.ok === true && providerLookup.provider) {
      actorType = "provider";
    }
  } catch {
    actorType = "user";
  }

  try {
    const threads = await lookupThreads(actorType, sessionPhone);
    const threadId = String(threads[0]?.ThreadID || "").trim();

    if (threadId) {
      redirect(
        actorType === "user"
          ? `/chat/thread/${encodeURIComponent(threadId)}?actor=user`
          : `/chat/thread/${encodeURIComponent(threadId)}`
      );
    }
  } catch {}

  redirect(actorType === "provider" ? "/provider/dashboard" : "/dashboard/my-requests");
}
