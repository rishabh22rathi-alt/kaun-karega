"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

type PageProps = {
  params: {
    taskId: string;
  };
};

type ProviderProfileResponse = {
  ok?: boolean;
  provider?: {
    ProviderID?: string;
    Phone?: string;
  };
  error?: string;
};

type AdminRequest = {
  TaskID: string;
  UserPhone: string;
  Category?: string;
  Area?: string;
  Details?: string;
  SelectedTimeframe?: string;
  ServiceDate?: string;
  TimeSlot?: string;
};

type AdminRequestsResponse = {
  ok?: boolean;
  requests?: AdminRequest[];
  error?: string;
};

type CreateThreadResponse = {
  ok?: boolean;
  threadId?: string;
  error?: string;
};

function buildRequiredTime(task: AdminRequest | null): string {
  if (!task) return "-";
  const timeframe = String(task.SelectedTimeframe || "").trim();
  const serviceDate = String(task.ServiceDate || "").trim();
  const timeSlot = String(task.TimeSlot || "").trim();

  if (timeframe) return timeframe;
  if (serviceDate && timeSlot) return `${serviceDate} ${timeSlot}`;
  if (serviceDate) return serviceDate;
  if (timeSlot) return timeSlot;
  return "-";
}

export default function ProviderChatEntryPage({ params }: PageProps) {
  const taskId = decodeURIComponent(params.taskId || "").trim();
  const router = useRouter();
  const [providerId, setProviderId] = useState("");
  const [task, setTask] = useState<AdminRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [startingChat, setStartingChat] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!taskId) {
      setError("Missing task ID.");
      setLoading(false);
      return;
    }

    const session = getAuthSession();
    const phone = String(session?.phone || "").replace(/\D/g, "").slice(-10);
    if (!phone) {
      router.replace(`/provider/login?next=${encodeURIComponent(`/chat/${taskId}`)}`);
      return;
    }

    let ignore = false;

    const load = async () => {
      setLoading(true);
      setError("");

      try {
        const profileRes = await fetch(
          `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(phone)}`,
          { cache: "no-store" }
        );
        const profileData = (await profileRes.json()) as ProviderProfileResponse;

        if (!profileRes.ok || !profileData.ok || !profileData.provider?.ProviderID) {
          router.replace(`/provider/login?next=${encodeURIComponent(`/chat/${taskId}`)}`);
          return;
        }

        const resolvedProviderId = String(profileData.provider.ProviderID || "").trim();
        if (!resolvedProviderId) {
          router.replace(`/provider/login?next=${encodeURIComponent(`/chat/${taskId}`)}`);
          return;
        }

        if (typeof window !== "undefined") {
          window.localStorage.setItem("kk_provider_id", resolvedProviderId);
          window.localStorage.setItem("kk_provider_phone", phone);
          window.localStorage.setItem("kk_user_role", "provider");
        }

        const taskRes = await fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_admin_requests" }),
        });
        const taskData = (await taskRes.json()) as AdminRequestsResponse;
        const matchedTask = Array.isArray(taskData.requests)
          ? taskData.requests.find((item) => String(item.TaskID || "").trim() === taskId) || null
          : null;

        if (!taskRes.ok || !taskData.ok || !matchedTask) {
          throw new Error(taskData.error || "Task not found");
        }

        if (ignore) return;
        setProviderId(resolvedProviderId);
        setTask(matchedTask);
      } catch (err) {
        if (ignore) return;
        setError(err instanceof Error ? err.message : "Unable to load task details.");
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void load();

    return () => {
      ignore = true;
    };
  }, [router, taskId]);

  const requiredTime = useMemo(() => buildRequiredTime(task), [task]);

  const handleStartChat = async () => {
    if (!task || !providerId || startingChat) return;

    setStartingChat(true);
    setError("");

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_chat_thread",
          TaskID: task.TaskID,
          ProviderID: providerId,
          UserPhone: task.UserPhone,
        }),
      });
      const data = (await res.json()) as CreateThreadResponse;

      if (!res.ok || !data.ok || !data.threadId) {
        throw new Error(data.error || "Unable to start chat.");
      }

      router.push(`/chat/thread/${encodeURIComponent(data.threadId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start chat.");
      setStartingChat(false);
    }
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Loading task summary...
        </div>
      </main>
    );
  }

  if (error || !task) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto max-w-2xl rounded-2xl border border-rose-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-rose-700">{error || "Task not found."}</p>
          <Link
            href="/provider/dashboard"
            className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Back to Provider Dashboard
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm font-medium text-slate-500">Task Summary</p>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {task.Category || "Service Request"}
        </h1>

        <dl className="mt-6 space-y-4 text-sm text-slate-700">
          <div>
            <dt className="font-semibold text-slate-900">Area</dt>
            <dd className="mt-1">{task.Area || "-"}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">Required Time</dt>
            <dd className="mt-1">{requiredTime}</dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-900">Task Description</dt>
            <dd className="mt-1 whitespace-pre-wrap">{task.Details || "-"}</dd>
          </div>
        </dl>

        {error ? <p className="mt-4 text-sm text-rose-700">{error}</p> : null}

        <button
          type="button"
          onClick={() => void handleStartChat()}
          disabled={startingChat}
          className="mt-8 inline-flex rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {startingChat ? "Starting..." : "Start Chat"}
        </button>
      </div>
    </main>
  );
}
