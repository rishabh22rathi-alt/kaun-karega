"use client";

import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";
import { getTaskDisplayLabel } from "@/lib/taskDisplay";

type PageProps = {
  params: Promise<{ taskId: string; providerId: string }>;
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
  DisplayID?: string;
  UserPhone?: string;
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
  error?: string;
  message?: string;
  ThreadID?: string;
  threadId?: string;
  thread?: {
    ThreadID?: string;
    threadId?: string;
  };
};

type ProviderNotificationsResponse = {
  ok?: boolean;
  notifications?: Array<{
    id: string;
    type?: string;
    seen?: boolean;
    payload?: { taskId?: string } | null;
  }>;
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

function extractThreadId(data: CreateThreadResponse): string {
  return String(
    data?.thread?.ThreadID ||
      data?.thread?.threadId ||
      data?.ThreadID ||
      data?.threadId ||
      ""
  ).trim();
}

export default function RespondPage({ params }: PageProps) {
  const { taskId, providerId } = use(params);
  const router = useRouter();
  const [trustedProviderPhone, setTrustedProviderPhone] = useState("");
  const [task, setTask] = useState<AdminRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ignoring, setIgnoring] = useState(false);
  const [error, setError] = useState("");
  const [providerMismatch, setProviderMismatch] = useState(false);

  useEffect(() => {
    if (!taskId || !providerId) {
      setError("Missing task or provider reference.");
      setLoading(false);
      return;
    }

    const session = getAuthSession();
    const phone = String(session?.phone || "").replace(/\D/g, "").slice(-10);
    if (phone.length !== 10) {
      router.replace(
        `/login?next=${encodeURIComponent(
          `/respond/${encodeURIComponent(taskId)}/${encodeURIComponent(providerId)}`
        )}`
      );
      return;
    }

    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError("");
      setProviderMismatch(false);

      try {
        // 1. Resolve the session's canonical provider record. If the logged-in
        //    phone is not a registered provider, bounce back through OTP so
        //    the user has a chance to switch accounts.
        const profileRes = await fetch(
          `/api/kk?action=get_provider_by_phone&phone=${encodeURIComponent(phone)}`,
          { cache: "no-store" }
        );
        const profileData = (await profileRes.json()) as ProviderProfileResponse;
        const sessionProviderId = String(profileData.provider?.ProviderID || "").trim();
        const sessionProviderPhone = String(profileData.provider?.Phone || "")
          .replace(/\D/g, "")
          .slice(-10);

        if (
          !profileRes.ok ||
          !profileData.ok ||
          !sessionProviderId ||
          sessionProviderPhone.length !== 10
        ) {
          if (cancelled) return;
          router.replace(
            `/login?next=${encodeURIComponent(
              `/respond/${encodeURIComponent(taskId)}/${encodeURIComponent(providerId)}`
            )}`
          );
          return;
        }

        // 2. URL providerId is untrusted. Only proceed if it matches the
        //    session-resolved providerId. Mismatch shows an explainer card
        //    and performs no mutation.
        if (sessionProviderId !== providerId) {
          if (cancelled) return;
          setProviderMismatch(true);
          return;
        }

        if (cancelled) return;
        setTrustedProviderPhone(sessionProviderPhone);

        // 3. Read-only fetch of task summary. Same admin-requests endpoint
        //    /chat/[taskId] uses for its summary card. No DB writes here.
        const taskRes = await fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_admin_requests" }),
        });
        const taskData = (await taskRes.json()) as AdminRequestsResponse;
        const matchedTask = Array.isArray(taskData.requests)
          ? taskData.requests.find(
              (item) => String(item.TaskID || "").trim() === taskId
            ) || null
          : null;

        if (!taskRes.ok || !taskData.ok || !matchedTask) {
          throw new Error(taskData.error || "Task not found");
        }

        if (cancelled) return;
        setTask(matchedTask);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Unable to load task details.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [providerId, router, taskId]);

  const requiredTime = buildRequiredTime(task);
  const taskDisplayLabel = getTaskDisplayLabel(task || { TaskID: taskId }, taskId);

  const handleRespond = async () => {
    if (!task || !trustedProviderPhone || submitting || ignoring) return;
    setSubmitting(true);
    setError("");

    try {
      // 1. Record the response. Same backend the in-app "Open Chat" button
      //    on /provider/my-jobs already calls. Idempotent on the
      //    (task, provider) pair. Soft-fail tolerated — the user-visible
      //    intent is "open the chat", and the response record is auxiliary.
      try {
        await fetch("/api/tasks/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, providerId }),
        });
      } catch {
        // Continue.
      }

      // 2. Create or fetch the chat thread for the LOGGED-IN provider.
      //    URL providerId is intentionally not forwarded — the chat action
      //    resolves the provider from the session phone (which has already
      //    been confirmed to match URL providerId via the mismatch guard).
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_create_or_get_thread",
          ActorType: "provider",
          TaskID: taskId,
          loggedInProviderPhone: trustedProviderPhone,
        }),
      });
      const data = (await res.json()) as CreateThreadResponse;
      const threadId = extractThreadId(data);

      if (!res.ok || !data?.ok || !threadId) {
        throw new Error(data?.error || data?.message || "Unable to open chat.");
      }

      router.replace(`/chat/thread/${encodeURIComponent(threadId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to open chat.");
      setSubmitting(false);
    }
  };

  const handleIgnore = async () => {
    if (submitting || ignoring) return;
    setIgnoring(true);
    setError("");

    // Best-effort: clear the matching `job_matched` notification from the
    // bell so the provider isn't re-pinged for a job they actively passed
    // on. Uses the existing /api/provider/notifications/seen endpoint
    // (accepts an array of notification UUIDs). The list endpoint exposes
    // payload.taskId, which lets us identify the right row without a new
    // server-side action. Soft-fail — any blip falls through to the
    // navigation below; nothing else mutates.
    try {
      const listRes = await fetch("/api/provider/notifications", {
        cache: "no-store",
      });
      if (listRes.ok) {
        const listData = (await listRes.json()) as ProviderNotificationsResponse;
        if (listData?.ok && Array.isArray(listData.notifications)) {
          const targetIds = listData.notifications
            .filter(
              (n) =>
                String(n.type || "") === "job_matched" &&
                !n.seen &&
                String(n.payload?.taskId || "") === taskId
            )
            .map((n) => String(n.id || "").trim())
            .filter(Boolean);
          if (targetIds.length > 0) {
            await fetch("/api/provider/notifications/seen", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ ids: targetIds }),
            });
          }
        }
      }
    } catch {
      // Soft-fail.
    }

    router.push("/provider/my-jobs");
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg rounded-2xl bg-white p-6 text-center text-sm text-slate-700 shadow-lg">
          Loading task details...
        </div>
      </main>
    );
  }

  if (providerMismatch) {
    return (
      <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg space-y-4 rounded-2xl bg-white p-6 text-center shadow-lg">
          <header className="space-y-1">
            <p className="text-xs font-semibold uppercase text-[#0EA5E9]">Kaun Karega</p>
            <h1 className="text-xl font-bold text-[#111827]">
              This job is for a different account
            </h1>
          </header>
          <p className="text-sm text-slate-700">
            The link was sent to a different provider. Sign in with that provider&apos;s
            number to respond.
          </p>
          <Link
            href="/provider/my-jobs"
            className="inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Go to my jobs
          </Link>
        </div>
      </main>
    );
  }

  if (error || !task) {
    return (
      <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-8">
        <div className="w-full max-w-lg space-y-3 rounded-2xl bg-white p-6 text-center shadow-lg">
          <header className="space-y-1">
            <p className="text-xs font-semibold uppercase text-[#0EA5E9]">Kaun Karega</p>
            <h1 className="text-2xl font-bold text-[#111827]">Job Response</h1>
          </header>
          <p className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-600">
            {error || "Task not found."}
          </p>
          <Link
            href="/provider/my-jobs"
            className="inline-block text-sm font-semibold text-sky-700 underline"
          >
            Back to my jobs
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-[#0EA5E9]">
          Kaun Karega
        </p>
        <p className="mt-2 text-sm font-medium text-slate-500">Task Summary</p>
        <h1 className="mt-1 text-2xl font-semibold text-slate-900">
          {task.Category || "Service Request"}
        </h1>
        <p className="mt-2 text-sm font-semibold text-slate-600">{taskDisplayLabel}</p>

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

        {error ? (
          <p className="mt-4 rounded-lg border border-rose-100 bg-rose-50 p-3 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => void handleRespond()}
            disabled={submitting || ignoring}
            className="inline-flex flex-1 items-center justify-center rounded-lg bg-sky-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? "Opening chat..." : "Respond / Chat with customer"}
          </button>
          <button
            type="button"
            onClick={() => void handleIgnore()}
            disabled={submitting || ignoring}
            className="inline-flex flex-1 items-center justify-center rounded-lg border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {ignoring ? "Saving..." : "Not interested"}
          </button>
        </div>
      </div>
    </main>
  );
}
