"use client";

import { useEffect, useState } from "react";

// Phase 7B: announcements list. Adds Queue Send + Cancel buttons.
// Queue is hard-restricted to target_audience='admins' in the UI;
// the backend store and route both re-enforce the same rule so a
// crafted POST cannot bypass.

type AnnouncementAudience =
  | "all"
  | "users"
  | "providers"
  | "admins"
  | "provider_category"
  | "providers_all";

type AnnouncementStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "queued"
  | "sending"
  | "canceling"
  | "sent"
  | "canceled"
  | "failed";

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  deep_link: string | null;
  target_audience: AnnouncementAudience;
  // Phase 7C: canonical categories.name when audience='provider_category',
  // null otherwise. DB cross-column CHECK enforces consistency.
  target_category: string | null;
  status: AnnouncementStatus;
  approval_required: boolean;
  approved_by_phone: string | null;
  approved_at: string | null;
  created_by_phone: string;
  created_at: string;
  updated_at: string;
};

// Phase 7C Steps 1-5: the UI exposes Queue Send for all three audience
// modes (admins, provider_category, providers_all) so the entire
// confirmation flow is exercisable end-to-end. The store's
// QUEUE_ALLOWED_AUDIENCES set still only includes 'admins', so the
// POST /queue call for provider_category / providers_all returns 400
// AUDIENCE_NOT_ALLOWED — the modal surfaces that as an actionError.
// This is intentional: UI is testable without unlocking actual sends.
// Legacy reserved values ('all', 'users', 'providers') stay blocked
// at the UI layer too.
const QUEUE_ENABLED_AUDIENCES: ReadonlySet<AnnouncementAudience> = new Set([
  "admins",
  "provider_category",
  "providers_all",
]);

// Phase 7C: literal string required to confirm an all-providers
// broadcast. Case-sensitive on purpose — adds friction proportional
// to blast radius. If a future product change wants this in another
// language, update the constant here and the audit copy in the
// composer's warning banner together.
const PROVIDERS_ALL_CONFIRM_PHRASE = "SEND TO ALL PROVIDERS";

const STATUS_BADGE: Record<AnnouncementStatus, string> = {
  draft: "border-slate-300 bg-slate-100 text-slate-700",
  pending_approval: "border-amber-300 bg-amber-50 text-amber-800",
  approved: "border-emerald-300 bg-emerald-50 text-emerald-800",
  queued: "border-sky-300 bg-sky-50 text-sky-800",
  sending: "border-indigo-300 bg-indigo-50 text-indigo-800",
  canceling: "border-orange-300 bg-orange-50 text-orange-800",
  sent: "border-emerald-300 bg-emerald-100 text-emerald-900",
  canceled: "border-slate-300 bg-slate-100 text-slate-600",
  failed: "border-rose-300 bg-rose-50 text-rose-800",
};

function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

type RecipientPreview = {
  total: number;
  by_actor: { users: number; providers: number; admins: number };
  audience: AnnouncementAudience;
  // Phase 7C: present only for provider_category audience.
  target_category?: string | null;
  providers_in_category?: number | null;
};

type AnnouncementsListProps = {
  announcements: AnnouncementRow[];
  loading: boolean;
  error: string;
  onEdit: (row: AnnouncementRow) => void;
  onAfterChange: () => void;
};

// ─── Queue Send confirmation modal ──────────────────────────────────
//
// Type-the-count gate: the admin must type the exact recipient total
// before the Confirm button enables. Adds friction proportional to
// blast radius; works equally well for 1 admin or 1000.

type QueueConfirmProps = {
  row: AnnouncementRow;
  preview: RecipientPreview | null;
  previewError: string;
  loading: boolean;
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

function QueueConfirmModal({
  row,
  preview,
  previewError,
  loading,
  submitting,
  onClose,
  onConfirm,
}: QueueConfirmProps) {
  const [typedCount, setTypedCount] = useState("");
  const [typedPhrase, setTypedPhrase] = useState("");

  const isProvidersAll = row.target_audience === "providers_all";
  const expectedCount = preview ? String(preview.total) : "";
  const countMatches =
    expectedCount.length > 0 && typedCount.trim() === expectedCount;
  // Phase 7C: providers_all requires a SECOND gate — type the literal
  // string. Case-sensitive on purpose. Other audiences ignore this
  // field; phraseMatches is forced true so the regular count gate
  // alone is sufficient.
  const phraseMatches = isProvidersAll
    ? typedPhrase === PROVIDERS_ALL_CONFIRM_PHRASE
    : true;
  const canConfirm = countMatches && phraseMatches;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <h3 className="text-base font-semibold text-slate-900">
          {isProvidersAll
            ? "Confirm broadcast to ALL providers"
            : "Confirm broadcast"}
        </h3>
        <p className="mt-1 text-xs text-slate-600">
          {isProvidersAll
            ? "This will reach every registered provider device on the platform. In-flight messages cannot be recalled."
            : "This will send an FCM push to every active device in the audience. In-flight messages cannot be recalled."}
        </p>

        {isProvidersAll ? (
          <p
            role="alert"
            data-testid="queue-confirm-providers-all-warning"
            className="mt-3 rounded-2xl border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900"
          >
            ⚠️ Two-field confirmation required for the all-providers audience.
          </p>
        ) : null}

        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">
          <p className="font-semibold text-slate-900">{row.title}</p>
          <p className="mt-1">{row.body}</p>
          <p className="mt-2 text-[11px] text-slate-500">
            Audience: <span className="font-mono">{row.target_audience}</span>
            {row.target_audience === "provider_category" && row.target_category ? (
              <>
                {" "}/ <span className="font-mono">{row.target_category}</span>
              </>
            ) : null}
            {row.deep_link ? (
              <>
                {" · "}Deep link: <span className="font-mono">{row.deep_link}</span>
              </>
            ) : null}
          </p>
        </div>

        {loading ? (
          <p className="mt-3 text-xs text-slate-500">Counting recipients…</p>
        ) : null}
        {previewError ? (
          <p
            role="alert"
            className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
          >
            {previewError}
          </p>
        ) : null}
        {preview ? (
          <div className="mt-3 text-xs text-slate-700">
            <p>
              Will reach{" "}
              <span
                className="font-bold text-slate-900"
                data-testid="queue-confirm-total"
              >
                {preview.total}
              </span>{" "}
              device{preview.total === 1 ? "" : "s"} in audience{" "}
              <span className="font-mono">{preview.audience}</span>
              {preview.target_category ? (
                <>
                  {" "}/ <span className="font-mono">{preview.target_category}</span>
                </>
              ) : null}
              .
            </p>
            <label className="mt-3 block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                Type {preview.total} to confirm
              </span>
              <input
                type="text"
                value={typedCount}
                onChange={(e) => setTypedCount(e.target.value)}
                inputMode="numeric"
                autoComplete="off"
                data-testid="queue-confirm-input"
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
              />
            </label>
            {isProvidersAll ? (
              <label className="mt-3 block">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-700">
                  Type {PROVIDERS_ALL_CONFIRM_PHRASE} to confirm (case-sensitive)
                </span>
                <input
                  type="text"
                  value={typedPhrase}
                  onChange={(e) => setTypedPhrase(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  data-testid="queue-confirm-phrase-input"
                  className="mt-1 block w-full rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm font-mono text-slate-900 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-200"
                />
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!canConfirm || submitting}
            data-testid="queue-confirm-button"
            className="rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Queueing…" : "Queue Send"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AnnouncementsList({
  announcements,
  loading,
  error,
  onEdit,
  onAfterChange,
}: AnnouncementsListProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");
  // Queue confirm modal state
  const [queueRow, setQueueRow] = useState<AnnouncementRow | null>(null);
  const [queuePreview, setQueuePreview] = useState<RecipientPreview | null>(null);
  const [queuePreviewError, setQueuePreviewError] = useState("");
  const [queuePreviewLoading, setQueuePreviewLoading] = useState(false);
  const [queueSubmitting, setQueueSubmitting] = useState(false);

  useEffect(() => {
    if (!queueRow) return;
    let cancelled = false;
    setQueuePreviewLoading(true);
    setQueuePreviewError("");
    setQueuePreview(null);
    fetch(
      `/api/admin/announcements/${encodeURIComponent(queueRow.id)}/preview-recipients`,
      { method: "GET", credentials: "same-origin", cache: "no-store" }
    )
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as {
          ok?: boolean;
          preview?: RecipientPreview;
          message?: string;
        } | null;
        if (cancelled) return;
        if (!res.ok || !data?.ok || !data.preview) {
          setQueuePreviewError(
            data?.message || `Could not load recipients (${res.status}).`
          );
          return;
        }
        setQueuePreview(data.preview);
      })
      .catch(() => {
        if (!cancelled) {
          setQueuePreviewError("Could not load recipients.");
        }
      })
      .finally(() => {
        if (!cancelled) setQueuePreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [queueRow]);

  const callMutation = async (
    id: string,
    method: "DELETE" | "POST",
    path: string,
    confirmMessage?: string
  ) => {
    if (busyId) return;
    if (confirmMessage && !window.confirm(confirmMessage)) return;
    setBusyId(id);
    setActionError("");
    try {
      const res = await fetch(path, { method, credentials: "same-origin" });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        setActionError(data?.message || `Action failed (${res.status}).`);
        return;
      }
      onAfterChange();
    } catch {
      setActionError("Action failed. Please check your connection.");
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = (row: AnnouncementRow) =>
    callMutation(
      row.id,
      "DELETE",
      `/api/admin/announcements/${encodeURIComponent(row.id)}`,
      `Delete draft "${row.title}"? This cannot be undone.`
    );

  const handleApprove = (row: AnnouncementRow) =>
    callMutation(
      row.id,
      "POST",
      `/api/admin/announcements/${encodeURIComponent(row.id)}/approve`
    );

  const handleCancel = (row: AnnouncementRow) =>
    callMutation(
      row.id,
      "POST",
      `/api/admin/announcements/${encodeURIComponent(row.id)}/cancel`,
      `Cancel broadcast "${row.title}"? In-flight messages will not be recalled.`
    );

  const openQueueModal = (row: AnnouncementRow) => {
    if (busyId) return;
    setActionError("");
    setQueueRow(row);
  };

  const closeQueueModal = () => {
    if (queueSubmitting) return;
    setQueueRow(null);
    setQueuePreview(null);
    setQueuePreviewError("");
  };

  const confirmQueue = async () => {
    if (!queueRow || queueSubmitting) return;
    setQueueSubmitting(true);
    setActionError("");
    try {
      const res = await fetch(
        `/api/admin/announcements/${encodeURIComponent(queueRow.id)}/queue`,
        { method: "POST", credentials: "same-origin" }
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        message?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        setActionError(data?.message || `Queue failed (${res.status}).`);
        return;
      }
      setQueueRow(null);
      setQueuePreview(null);
      onAfterChange();
    } catch {
      setActionError("Queue failed. Please check your connection.");
    } finally {
      setQueueSubmitting(false);
    }
  };

  return (
    <section
      data-testid="announcements-list"
      className="rounded-2xl border border-slate-200 bg-white shadow-sm"
    >
      <div className="border-b border-slate-200 px-5 py-3">
        <h2 className="text-base font-semibold text-slate-900">
          Existing Announcements
        </h2>
        <p className="mt-0.5 text-xs text-slate-500">
          Most recent first. Phase 7B sends to <span className="font-mono">admins</span>{" "}
          audience only — other audiences cannot be queued yet.
        </p>
      </div>

      {actionError ? (
        <p
          role="alert"
          className="mx-5 mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700"
        >
          {actionError}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                Title
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                Audience
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                Status
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                Updated
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                Created by
              </th>
              <th className="px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {loading && announcements.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-sm text-slate-500"
                >
                  Loading announcements…
                </td>
              </tr>
            ) : null}
            {!loading && error ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-sm text-rose-700"
                >
                  {error}
                </td>
              </tr>
            ) : null}
            {!loading && !error && announcements.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-3 py-6 text-center text-sm text-slate-500"
                >
                  No announcements yet. Use the composer above to draft one.
                </td>
              </tr>
            ) : null}
            {announcements.map((row) => {
              const isBusy = busyId === row.id;
              const queueAllowed = QUEUE_ENABLED_AUDIENCES.has(
                row.target_audience
              );
              return (
                <tr key={row.id} data-testid={`announcement-row-${row.id}`}>
                  <td className="px-3 py-2 align-top">
                    <p className="font-semibold text-slate-900">{row.title}</p>
                    <p className="mt-0.5 max-w-xs truncate text-xs text-slate-500">
                      {row.body}
                    </p>
                  </td>
                  <td className="px-3 py-2 align-top text-xs font-mono text-slate-700">
                    {row.target_audience}
                    {row.target_audience === "provider_category" &&
                    row.target_category ? (
                      <>
                        {" / "}
                        <span data-testid={`announcement-target-category-${row.id}`}>
                          {row.target_category}
                        </span>
                      </>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 align-top">
                    <span
                      data-testid={`announcement-status-${row.id}`}
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_BADGE[row.status]}`}
                    >
                      {row.status.replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-3 py-2 align-top text-xs text-slate-600">
                    {formatDateTime(row.updated_at)}
                  </td>
                  <td className="px-3 py-2 align-top text-xs font-mono text-slate-600">
                    {row.created_by_phone}
                  </td>
                  <td className="px-3 py-2 align-top text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {row.status === "draft" ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onEdit(row)}
                            disabled={isBusy}
                            className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(row)}
                            disabled={isBusy}
                            data-testid={`announcement-delete-${row.id}`}
                            className="rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                          >
                            Delete
                          </button>
                        </>
                      ) : null}
                      {row.status === "pending_approval" ? (
                        <button
                          type="button"
                          onClick={() => handleApprove(row)}
                          disabled={isBusy}
                          data-testid={`announcement-approve-${row.id}`}
                          className="rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 transition hover:bg-emerald-100 disabled:opacity-50"
                        >
                          Approve
                        </button>
                      ) : null}
                      {row.status === "approved" ? (
                        queueAllowed ? (
                          <button
                            type="button"
                            onClick={() => openQueueModal(row)}
                            disabled={isBusy}
                            data-testid={`announcement-queue-${row.id}`}
                            className="rounded-md border border-rose-300 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-800 transition hover:bg-rose-100 disabled:opacity-50"
                          >
                            Queue Send
                          </button>
                        ) : (
                          <span
                            data-testid={`announcement-queue-blocked-${row.id}`}
                            title="Phase 7B sends to admin audience only."
                            className="rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500"
                          >
                            Sending unavailable
                          </span>
                        )
                      ) : null}
                      {row.status === "queued" ||
                      row.status === "sending" ||
                      row.status === "canceling" ? (
                        <button
                          type="button"
                          onClick={() => handleCancel(row)}
                          disabled={isBusy || row.status === "canceling"}
                          data-testid={`announcement-cancel-${row.id}`}
                          className="rounded-md border border-orange-300 bg-orange-50 px-2.5 py-1 text-[11px] font-semibold text-orange-800 transition hover:bg-orange-100 disabled:opacity-50"
                        >
                          {row.status === "canceling" ? "Canceling…" : "Cancel"}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {queueRow ? (
        <QueueConfirmModal
          row={queueRow}
          preview={queuePreview}
          previewError={queuePreviewError}
          loading={queuePreviewLoading}
          submitting={queueSubmitting}
          onClose={closeQueueModal}
          onConfirm={confirmQueue}
        />
      ) : null}
    </section>
  );
}
