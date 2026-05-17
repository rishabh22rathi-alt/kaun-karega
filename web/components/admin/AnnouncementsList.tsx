"use client";

import { useState } from "react";

// Phase 7A: announcements list. Read + light mutations (delete draft,
// approve pending). No queue/send buttons — those live in Phase 7B.

type AnnouncementAudience = "all" | "users" | "providers" | "admins";

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
  status: AnnouncementStatus;
  approval_required: boolean;
  approved_by_phone: string | null;
  approved_at: string | null;
  created_by_phone: string;
  created_at: string;
  updated_at: string;
};

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

type AnnouncementsListProps = {
  announcements: AnnouncementRow[];
  loading: boolean;
  error: string;
  onEdit: (row: AnnouncementRow) => void;
  onAfterChange: () => void;
};

export default function AnnouncementsList({
  announcements,
  loading,
  error,
  onEdit,
  onAfterChange,
}: AnnouncementsListProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const callAction = async (
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
    callAction(
      row.id,
      "DELETE",
      `/api/admin/announcements/${encodeURIComponent(row.id)}`,
      `Delete draft "${row.title}"? This cannot be undone.`
    );

  const handleApprove = (row: AnnouncementRow) =>
    callAction(
      row.id,
      "POST",
      `/api/admin/announcements/${encodeURIComponent(row.id)}/approve`
    );

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
          Most recent first. Drafts can be edited; approved announcements
          wait for Phase 7B to be queued and sent.
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
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
