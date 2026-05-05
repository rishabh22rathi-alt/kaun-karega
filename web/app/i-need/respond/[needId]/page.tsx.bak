"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";

import { getAuthSession } from "@/lib/auth";

function normalizePhoneToTen(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits.slice(-10);
}

function getUserPhone(): string {
  const session = getAuthSession();
  if (session?.phone) return normalizePhoneToTen(session.phone);
  return "";
}

export default function RespondToNeedPage() {
  const params = useParams();
  const router = useRouter();
  const needId = String(params?.needId ?? "");
  const [error, setError] = useState("");

  useEffect(() => {
    let isActive = true;

    async function connectToThread() {
      const safeNeedId = needId.trim();
      if (!safeNeedId) {
        if (isActive) setError("Need not found. Please return and try again.");
        return;
      }

      const userPhone = getUserPhone();
      if (!userPhone) {
        const nextPath = `/i-need/respond/${encodeURIComponent(safeNeedId)}`;
        router.replace(`/login?next=${encodeURIComponent(nextPath)}`);
        return;
      }

      try {
        const response = await fetch("/api/kk", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "need_chat_create_or_get_thread",
            NeedID: safeNeedId,
            ResponderPhone: userPhone,
          }),
        });

        const raw = await response.text();
        let data: Record<string, unknown> | null = null;

        try {
          data = JSON.parse(raw) as Record<string, unknown>;
        } catch {
          data = null;
        }

        const thread =
          data && typeof data.thread === "object" && data.thread !== null
            ? (data.thread as Record<string, unknown>)
            : null;
        const threadId = typeof thread?.ThreadID === "string" ? thread.ThreadID.trim() : "";

        if (!response.ok || data?.ok !== true || !threadId) {
          throw new Error(
            String(
              data?.error ||
                data?.message ||
                "We could not start a conversation for this need right now."
            )
          );
        }

        router.replace(`/i-need/chat/${encodeURIComponent(threadId)}?role=${encodeURIComponent("responder")}`);
      } catch (err) {
        if (!isActive) return;
        setError(
          err instanceof Error
            ? err.message
            : "We could not start a conversation for this need right now."
        );
      }
    }

    void connectToThread();

    return () => {
      isActive = false;
    };
  }, [needId, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
        {!error ? (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#003d20]/5">
              <svg
                className="h-6 w-6 animate-spin text-[#003d20]"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>

            <h1 className="mt-5 text-lg font-semibold text-slate-900">Connecting you...</h1>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              We&apos;re preparing your conversation for this need.
            </p>

            {needId && <p className="mt-4 text-xs text-slate-300">Need #{needId}</p>}
          </>
        ) : (
          <>
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-50">
              <svg
                className="h-5 w-5 text-rose-400"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                />
              </svg>
            </div>

            <h1 className="mt-5 text-lg font-semibold text-slate-900">Something went wrong</h1>
            <p className="mt-2 text-sm leading-relaxed text-rose-600">{error}</p>
            <button
              type="button"
              onClick={() => router.back()}
              className="mt-5 rounded-xl border border-slate-200 bg-white px-5 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
            >
              Go back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
