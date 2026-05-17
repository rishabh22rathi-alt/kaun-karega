"use client";

import { useEffect, useMemo, useState } from "react";

// Phase 7A: announcement composer. New-draft mode or edit-existing-draft
// mode (controlled by `editingId`). No send / queue / approve buttons —
// those live on the list rows so the composer surface stays single-
// purpose. Submit-for-approval is here because it's the natural last
// step after writing copy.

type AnnouncementAudience = "all" | "users" | "providers" | "admins";

export type ComposerDraft = {
  id: string | null;
  title: string;
  body: string;
  target_audience: AnnouncementAudience;
  deep_link: string;
};

type RecipientPreview = {
  audience: AnnouncementAudience;
  total: number;
  by_actor: { users: number; providers: number; admins: number };
};

type AudienceOption = {
  value: AnnouncementAudience;
  label: string;
};

const AUDIENCE_OPTIONS: ReadonlyArray<AudienceOption> = [
  { value: "all", label: "Everyone (users + providers + admins)" },
  { value: "users", label: "Users only" },
  { value: "providers", label: "Providers only" },
  { value: "admins", label: "Admins only" },
];

const TITLE_MAX = 65;
const BODY_MAX = 240;
const DEEP_LINK_MAX = 256;

type AnnouncementComposerProps = {
  // null → create-new mode. Non-null → edit-draft mode.
  editingId: string | null;
  initialDraft: ComposerDraft | null;
  // Called after a successful save / submit / cancel so the parent can
  // refresh the list and clear edit state.
  onSaved?: () => void;
  onCancelEdit?: () => void;
};

const EMPTY_DRAFT: ComposerDraft = {
  id: null,
  title: "",
  body: "",
  target_audience: "all",
  deep_link: "",
};

export default function AnnouncementComposer({
  editingId,
  initialDraft,
  onSaved,
  onCancelEdit,
}: AnnouncementComposerProps) {
  const [draft, setDraft] = useState<ComposerDraft>(
    initialDraft ?? EMPTY_DRAFT
  );
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<RecipientPreview | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Re-hydrate when parent switches the editing row. Resets preview
  // so the count reflects the new audience selection.
  useEffect(() => {
    setDraft(initialDraft ?? EMPTY_DRAFT);
    setPreview(null);
    setError("");
    setSuccess("");
  }, [editingId, initialDraft]);

  const titleRemaining = TITLE_MAX - draft.title.length;
  const bodyRemaining = BODY_MAX - draft.body.length;
  const deepLinkRemaining = DEEP_LINK_MAX - draft.deep_link.length;

  const isValid = useMemo(() => {
    if (draft.title.trim().length === 0) return false;
    if (draft.title.length > TITLE_MAX) return false;
    if (draft.body.trim().length === 0) return false;
    if (draft.body.length > BODY_MAX) return false;
    if (draft.deep_link.length > DEEP_LINK_MAX) return false;
    return true;
  }, [draft]);

  const audienceLabel =
    AUDIENCE_OPTIONS.find((o) => o.value === draft.target_audience)?.label ??
    draft.target_audience;

  const handleSaveDraft = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    setError("");
    setSuccess("");
    const payload = {
      title: draft.title.trim(),
      body: draft.body.trim(),
      target_audience: draft.target_audience,
      deep_link: draft.deep_link.trim() || null,
    };
    const url = editingId
      ? `/api/admin/announcements/${encodeURIComponent(editingId)}`
      : "/api/admin/announcements";
    const method = editingId ? "PATCH" : "POST";
    try {
      const res = await fetch(url, {
        method,
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        announcement?: { id?: string };
        message?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.message || `Could not save draft (${res.status}).`);
        return;
      }
      setSuccess(editingId ? "Draft updated." : "Draft saved.");
      const savedId = String(data.announcement?.id ?? "");
      if (!editingId && savedId) {
        setDraft({ ...draft, id: savedId });
      }
      onSaved?.();
    } catch {
      setError("Could not save draft. Please check your connection.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = async () => {
    if (!editingId || submitting) return;
    setSubmitting(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetch(
        `/api/admin/announcements/${encodeURIComponent(editingId)}/submit`,
        {
          method: "POST",
          credentials: "same-origin",
        }
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        announcement?: { status?: string };
        message?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.message || `Could not submit (${res.status}).`);
        return;
      }
      const nextStatus = String(data.announcement?.status ?? "");
      setSuccess(
        nextStatus === "approved"
          ? "Submitted and auto-approved (approval not required)."
          : "Submitted for approval."
      );
      onSaved?.();
    } catch {
      setError("Could not submit. Please check your connection.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleLoadPreview = async () => {
    if (!editingId) {
      setError("Save the draft first to preview recipients.");
      return;
    }
    setPreviewLoading(true);
    setError("");
    try {
      const res = await fetch(
        `/api/admin/announcements/${encodeURIComponent(editingId)}/preview-recipients`,
        {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        }
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        preview?: RecipientPreview;
        message?: string;
      } | null;
      if (!res.ok || !data?.ok || !data.preview) {
        setError(data?.message || `Could not load preview (${res.status}).`);
        return;
      }
      setPreview(data.preview);
    } catch {
      setError("Could not load recipient preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <section
      data-testid="announcement-composer"
      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">
            {editingId ? "Edit Draft" : "Compose Announcement"}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Phase 7A — drafts and approval only. Sending lands in Phase 7B.
          </p>
        </div>
        {editingId ? (
          <button
            type="button"
            onClick={() => onCancelEdit?.()}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100"
          >
            Cancel edit
          </button>
        ) : null}
      </div>

      {error ? (
        <p
          role="alert"
          data-testid="announcement-composer-error"
          className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {error}
        </p>
      ) : null}
      {success ? (
        <p
          role="status"
          data-testid="announcement-composer-success"
          className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700"
        >
          {success}
        </p>
      ) : null}

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* ─── Composer fields ─── */}
        <div className="space-y-4">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Title
            </span>
            <input
              type="text"
              value={draft.title}
              maxLength={TITLE_MAX}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              data-testid="announcement-title-input"
              placeholder="Short, clear title that reads well in a notification tray"
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
            <p
              className={`mt-1 text-[11px] ${
                titleRemaining < 0 ? "text-rose-600" : "text-slate-500"
              }`}
            >
              {titleRemaining} of {TITLE_MAX} characters remaining
            </p>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Body
            </span>
            <textarea
              value={draft.body}
              maxLength={BODY_MAX}
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
              rows={3}
              data-testid="announcement-body-input"
              placeholder="The notification message your audience will see."
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
            <p
              className={`mt-1 text-[11px] ${
                bodyRemaining < 0 ? "text-rose-600" : "text-slate-500"
              }`}
            >
              {bodyRemaining} of {BODY_MAX} characters remaining
            </p>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Target audience
            </span>
            <select
              value={draft.target_audience}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  target_audience: e.target.value as AnnouncementAudience,
                })
              }
              data-testid="announcement-audience-select"
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              {AUDIENCE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Deep link (optional)
            </span>
            <input
              type="text"
              value={draft.deep_link}
              maxLength={DEEP_LINK_MAX}
              onChange={(e) =>
                setDraft({ ...draft, deep_link: e.target.value })
              }
              data-testid="announcement-deeplink-input"
              placeholder="e.g. /provider/dashboard or https://kaunkarega.in/..."
              className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
            />
            <p
              className={`mt-1 text-[11px] ${
                deepLinkRemaining < 0 ? "text-rose-600" : "text-slate-500"
              }`}
            >
              {deepLinkRemaining} of {DEEP_LINK_MAX} characters remaining
            </p>
          </label>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={!isValid || saving}
              data-testid="announcement-save-button"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Saving…" : editingId ? "Update Draft" : "Save Draft"}
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!editingId || submitting}
              data-testid="announcement-submit-button"
              title={
                editingId
                  ? ""
                  : "Save the draft before submitting for approval."
              }
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit for Approval"}
            </button>
            <button
              type="button"
              onClick={handleLoadPreview}
              disabled={!editingId || previewLoading}
              data-testid="announcement-preview-button"
              title={
                editingId
                  ? ""
                  : "Save the draft before checking recipient counts."
              }
              className="ml-auto rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {previewLoading
                ? "Loading…"
                : preview
                  ? "Refresh recipient count"
                  : "Preview recipients"}
            </button>
          </div>

          {preview ? (
            <div
              data-testid="announcement-preview-result"
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-700"
            >
              <p className="font-semibold text-slate-900">
                Recipients for{" "}
                <span className="font-mono">{preview.audience}</span>:{" "}
                <span data-testid="announcement-preview-total">
                  {preview.total}
                </span>{" "}
                device{preview.total === 1 ? "" : "s"}
              </p>
              <p className="mt-1 text-slate-500">
                Across all active devices: users {preview.by_actor.users} ·
                providers {preview.by_actor.providers} · admins{" "}
                {preview.by_actor.admins}
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-400">
                Counts only. No tokens, phones, or identifiers exposed.
              </p>
            </div>
          ) : null}
        </div>

        {/* ─── Mobile preview ─── */}
        <aside className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">
            Preview
          </p>
          <div className="rounded-3xl border border-slate-300 bg-slate-900 p-3 shadow-inner">
            <div className="rounded-2xl bg-slate-800 px-3 py-3 text-slate-100">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-slate-300">
                <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-emerald-500 text-[10px] font-bold text-white">
                  KK
                </span>
                <span>Kaun Karega</span>
                <span className="ml-auto text-slate-400">now</span>
              </div>
              <p className="mt-2 text-sm font-semibold leading-snug text-white">
                {draft.title.trim() || "Notification title"}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-slate-200">
                {draft.body.trim() || "Notification body text will appear here."}
              </p>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Mock of the Android notification tray. Actual styling depends on
            the device.
          </p>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Audience: <span className="font-semibold">{audienceLabel}</span>
          </p>
          {draft.deep_link.trim() ? (
            <p className="break-all text-[11px] leading-relaxed text-slate-500">
              Tap opens:{" "}
              <span className="font-mono">{draft.deep_link.trim()}</span>
            </p>
          ) : null}
        </aside>
      </div>
    </section>
  );
}
