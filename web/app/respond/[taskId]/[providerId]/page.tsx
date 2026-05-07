"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getAuthSession } from "@/lib/auth";

type PageProps = {
  params: Promise<{ taskId: string; providerId: string }>;
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

// ─── DEBUG START — temporary diagnostics for /respond CTA failure ─────────
// Remove this block, the `debug` state, the diag capture inside `run`, and
// the <pre> render below (each marked with DEBUG START/END) once the
// WhatsApp CTA → chat flow is confirmed working in production.
type DebugInfo = {
  taskId: string;
  providerId: string;
  phone10: string;
  origin: string;
  respondStatus: number | null;
  respondBody: unknown;
  threadStatus: number | null;
  threadBody: unknown;
};

function safeParseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}
// ─── DEBUG END ────────────────────────────────────────────────────────────

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
  const [error, setError] = useState("");
  // DEBUG START
  const [debug, setDebug] = useState<DebugInfo | null>(null);
  // DEBUG END

  useEffect(() => {
    if (!taskId || !providerId) {
      setError("Missing task or provider reference.");
      return;
    }

    const session = getAuthSession();
    const phone = String(session?.phone || "").replace(/\D/g, "").slice(-10);
    if (phone.length !== 10) {
      router.replace(
        `/provider/login?next=${encodeURIComponent(
          `/respond/${encodeURIComponent(taskId)}/${encodeURIComponent(providerId)}`
        )}`
      );
      return;
    }

    let cancelled = false;

    const run = async () => {
      // DEBUG START — capture every step into `diag`; only surfaced on error.
      const diag: DebugInfo = {
        taskId,
        providerId,
        phone10: phone,
        origin: typeof window !== "undefined" ? window.location.origin : "",
        respondStatus: null,
        respondBody: null,
        threadStatus: null,
        threadBody: null,
      };
      // DEBUG END

      // 1. Record the response. Same backend the in-app "Open Chat" button
      //    already calls. Idempotent. Soft-fail — a transient blip here
      //    must not block the provider from reaching the chat.
      try {
        const respondRes = await fetch("/api/tasks/respond", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ taskId, providerId }),
        });
        // DEBUG START
        diag.respondStatus = respondRes.status;
        diag.respondBody = safeParseJson(await respondRes.text());
        // DEBUG END
      } catch (err) {
        // DEBUG START
        diag.respondBody =
          err instanceof Error ? `network: ${err.message}` : "network error";
        // DEBUG END
      }

      // 2. Create or fetch the chat thread for the LOGGED-IN provider.
      //    URL providerId is intentionally not forwarded — the chat action
      //    resolves the provider from the session phone and rejects the
      //    request if that provider isn't matched to this task.
      try {
        const res = await fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "chat_create_or_get_thread",
            ActorType: "provider",
            TaskID: taskId,
            loggedInProviderPhone: phone,
          }),
        });
        // DEBUG START — read body via .text() so we can both diagnose and
        // pass it through the existing parse path. (.json() consumes the
        // stream; .text()+JSON.parse() captures both shape and raw fallback.)
        const rawText = await res.text();
        const parsed = safeParseJson(rawText);
        diag.threadStatus = res.status;
        diag.threadBody = parsed;
        const data = (parsed && typeof parsed === "object" ? parsed : {}) as CreateThreadResponse;
        // DEBUG END
        const threadId = extractThreadId(data);

        if (cancelled) return;
        if (!res.ok || !data?.ok || !threadId) {
          setError(data?.error || data?.message || "Unable to open chat.");
          // DEBUG START
          console.warn("[respond] open chat failed", diag);
          setDebug(diag);
          // DEBUG END
          return;
        }

        router.replace(`/chat/thread/${encodeURIComponent(threadId)}`);
      } catch (err) {
        if (cancelled) return;
        // DEBUG START
        diag.threadBody =
          err instanceof Error ? `network: ${err.message}` : "network error";
        console.warn("[respond] open chat exception", diag);
        setDebug(diag);
        // DEBUG END
        setError("Network error. Please try again.");
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [taskId, providerId, router]);

  return (
    <main className="min-h-screen bg-[#FFE3C2] flex items-center justify-center px-4 py-8">
      <div
        className={`w-full ${debug ? "max-w-2xl" : "max-w-lg"} bg-white rounded-2xl shadow-lg p-6 space-y-3 text-center`}
      >
        <header className="space-y-1">
          <p className="text-xs font-semibold text-[#0EA5E9] uppercase">
            Kaun Karega
          </p>
          <h1 className="text-2xl font-bold text-[#111827]">Job Response</h1>
        </header>

        {!error ? (
          <p className="text-sm text-[#111827]">Opening chat...</p>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
              {error}
            </p>
            <a
              href="/provider/my-jobs"
              className="inline-block text-sm font-semibold text-sky-700 underline"
            >
              Back to my jobs
            </a>

            {/* ─── DEBUG START — on-screen diagnostic shown only on failure.
                Delete this entire {debug ? ... : null} block (and the matching
                DEBUG markers above) once the issue is resolved. ─── */}
            {debug ? (
              <pre className="mt-4 text-left text-[11px] leading-5 text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
{`URL taskId       : ${debug.taskId}
URL providerId   : ${debug.providerId}
session phone    : ${debug.phone10}
origin           : ${debug.origin}

/api/tasks/respond
  status         : ${debug.respondStatus ?? "-"}
  body           : ${JSON.stringify(debug.respondBody, null, 2)}

/api/kk chat_create_or_get_thread
  status         : ${debug.threadStatus ?? "-"}
  body           : ${JSON.stringify(debug.threadBody, null, 2)}`}
              </pre>
            ) : null}
            {/* ─── DEBUG END ─── */}
          </div>
        )}
      </div>
    </main>
  );
}
