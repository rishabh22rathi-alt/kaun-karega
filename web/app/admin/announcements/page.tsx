"use client";

import { useCallback, useEffect, useState } from "react";

import AnnouncementComposer, {
  type ComposerDraft,
} from "@/components/admin/AnnouncementComposer";
import AnnouncementsList, {
  type AnnouncementRow,
} from "@/components/admin/AnnouncementsList";

// Phase 7E (Hobby plan): the worker outcome shapes mirror
// lib/announcements/worker.ts → WorkerOutcome. Keep this in sync if
// the worker's status enum changes.
type WorkerOutcome =
  | { status: "send_disabled"; reason: string }
  | { status: "no_jobs"; reason: string }
  | { status: "audience_blocked"; reason: string; announcementId?: string }
  | { status: "push_not_configured"; reason: string; announcementId?: string }
  | {
      status: "batch_sent" | "done" | "canceled";
      announcementId?: string;
      jobId?: string;
      batch?: {
        attempted: number;
        sent: number;
        failed: number;
        invalid_token: number;
      };
      cursor?: { previous_offset: number; next_offset: number; total: number };
    }
  | { status: "failed"; announcementId?: string; jobId?: string; reason: string };

type WorkerOutcomeStatus = WorkerOutcome["status"];

function formatOutcomeMessage(outcome: WorkerOutcome): string {
  switch (outcome.status) {
    case "no_jobs":
      return "No queued announcements right now.";
    case "send_disabled":
      return "Sending is disabled (ANNOUNCEMENT_SEND_ENABLED is not 'true' on this deployment).";
    case "push_not_configured":
      return "Firebase Admin is not configured on this deployment. Sending paused.";
    case "audience_blocked":
      return `Worker refused to send: ${outcome.reason}`;
    case "batch_sent": {
      const sent = outcome.batch?.sent ?? 0;
      const failed = outcome.batch?.failed ?? 0;
      const invalid = outcome.batch?.invalid_token ?? 0;
      const remaining = Math.max(
        0,
        (outcome.cursor?.total ?? 0) - (outcome.cursor?.next_offset ?? 0)
      );
      const remainingNote =
        remaining > 0
          ? ` ${remaining} device${remaining === 1 ? "" : "s"} remaining — click again to process the next batch.`
          : "";
      return `Batch sent: ${sent} delivered, ${failed} failed, ${invalid} invalid token${invalid === 1 ? "" : "s"}.${remainingNote}`;
    }
    case "done":
      return "Broadcast complete.";
    case "canceled":
      return "Broadcast canceled.";
    case "failed":
      return `Worker reported a failure: ${outcome.reason}`;
    default:
      return "Worker finished.";
  }
}

function outcomeTone(status: WorkerOutcomeStatus): string {
  switch (status) {
    case "batch_sent":
    case "done":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "no_jobs":
      return "border-slate-200 bg-slate-50 text-slate-700";
    case "send_disabled":
    case "push_not_configured":
    case "audience_blocked":
    case "canceled":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "failed":
    default:
      return "border-rose-200 bg-rose-50 text-rose-800";
  }
}

// Phase 7A: admin Announcements page. Composer at top, list below.
// Page auth is enforced by web/app/admin/layout.tsx → AdminLayoutClient
// (redirects non-admins to /login). The /api/admin/announcements/*
// routes also gate via requireAdminSession as defense in depth.

export default function AdminAnnouncementsPage() {
  const [announcements, setAnnouncements] = useState<AnnouncementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Phase 7E manual-trigger state. Holds the last worker outcome so
  // the admin can see whether the click sent a batch / hit no_jobs /
  // was send_disabled. Cleared the next click.
  const [runningWorker, setRunningWorker] = useState(false);
  const [workerOutcome, setWorkerOutcome] = useState<WorkerOutcome | null>(null);
  const [workerError, setWorkerError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/admin/announcements", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          announcements?: AnnouncementRow[];
          message?: string;
        } | null;
        if (cancelled) return;
        if (!res.ok || !data?.ok || !Array.isArray(data.announcements)) {
          setError(data?.message || `Failed to load announcements (${res.status}).`);
          setAnnouncements([]);
          return;
        }
        setAnnouncements(data.announcements);
      } catch {
        if (!cancelled) {
          setError("Could not load announcements. Please check your connection.");
          setAnnouncements([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const triggerRefresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  const handleEdit = useCallback((row: AnnouncementRow) => {
    setEditingId(row.id);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleSaved = useCallback(() => {
    triggerRefresh();
  }, [triggerRefresh]);

  // Phase 7E: manual "Send Queued Now" trigger. POSTs to the
  // admin-cookie-gated route /api/admin/announcements/worker/run-now,
  // which internally calls the same runOnce() as the cron + manual
  // tick paths. Returns at most one batch's worth of work — admin
  // clicks again to process the next batch when a broadcast spans
  // multiple. Outcome rendered below the button.
  const handleRunWorker = useCallback(async () => {
    if (runningWorker) return;
    setRunningWorker(true);
    setWorkerError("");
    setWorkerOutcome(null);
    try {
      const res = await fetch(
        "/api/admin/announcements/worker/run-now",
        {
          method: "POST",
          credentials: "same-origin",
        }
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        outcome?: WorkerOutcome;
        message?: string;
      } | null;
      if (!res.ok || !data?.ok || !data.outcome) {
        setWorkerError(
          data?.message || `Worker call failed (${res.status}).`
        );
        return;
      }
      setWorkerOutcome(data.outcome);
      // Refresh the list so the admin can see updated row status
      // (queued → sending → sent etc.).
      triggerRefresh();
    } catch {
      setWorkerError(
        "Could not reach the worker. Please check your connection."
      );
    } finally {
      setRunningWorker(false);
    }
  }, [runningWorker, triggerRefresh]);

  const editingRow = editingId
    ? announcements.find((row) => row.id === editingId) ?? null
    : null;

  // Phase 7D: convert the row's ISO banner_expires_at to the
  // datetime-local format ("YYYY-MM-DDTHH:mm") the composer's
  // <input type="datetime-local"> expects. Empty string when null.
  const formatForDatetimeLocal = (iso: string | null): string => {
    if (!iso) return "";
    const parsed = Date.parse(iso);
    if (Number.isNaN(parsed)) return "";
    const d = new Date(parsed);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const composerDraft: ComposerDraft | null = editingRow
    ? {
        id: editingRow.id,
        title: editingRow.title,
        body: editingRow.body,
        target_audience: editingRow.target_audience,
        target_category: editingRow.target_category ?? "",
        deep_link: editingRow.deep_link ?? "",
        send_push: editingRow.send_push,
        show_as_banner: editingRow.show_as_banner,
        banner_priority: editingRow.banner_priority,
        banner_expires_at: formatForDatetimeLocal(editingRow.banner_expires_at),
        banner_dismissible: editingRow.banner_dismissible,
        banner_cta_label: editingRow.banner_cta_label ?? "",
      }
    : null;

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 py-2">
      <header>
        <h1 className="text-2xl font-bold text-slate-900">Announcements</h1>
        <p className="mt-1 text-sm text-slate-600">
          Compose and approve platform-wide announcements. Sending happens
          via daily cron on the free Vercel plan; use the manual trigger
          below to dispatch queued announcements immediately.
        </p>
      </header>

      {/* Phase 7E: manual worker trigger. Same runOnce() as the cron
          tick — admin cookie is the only gate. One click processes
          one batch; click again to advance multi-batch broadcasts. */}
      <section
        data-testid="announcement-worker-card"
        className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              Send Queued Now
            </h2>
            <p className="mt-1 text-xs text-slate-600">
              On the free Vercel plan, automatic sending runs once daily.
              Use this button to process queued announcements immediately.
              Click again to advance broadcasts that span multiple batches.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunWorker}
            disabled={runningWorker}
            data-testid="announcement-worker-run-now"
            className="inline-flex shrink-0 items-center justify-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
          >
            {runningWorker ? "Running…" : "Send Queued Now"}
          </button>
        </div>

        {workerError ? (
          <p
            role="alert"
            data-testid="announcement-worker-error"
            className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700"
          >
            {workerError}
          </p>
        ) : null}

        {workerOutcome ? (
          <p
            role="status"
            data-testid={`announcement-worker-outcome-${workerOutcome.status}`}
            className={`mt-3 rounded-2xl border px-4 py-2 text-sm ${outcomeTone(workerOutcome.status)}`}
          >
            {formatOutcomeMessage(workerOutcome)}
          </p>
        ) : null}
      </section>

      <AnnouncementComposer
        editingId={editingId}
        initialDraft={composerDraft}
        onSaved={handleSaved}
        onCancelEdit={handleCancelEdit}
      />

      <AnnouncementsList
        announcements={announcements}
        loading={loading}
        error={error}
        onEdit={handleEdit}
        onAfterChange={triggerRefresh}
      />
    </div>
  );
}
