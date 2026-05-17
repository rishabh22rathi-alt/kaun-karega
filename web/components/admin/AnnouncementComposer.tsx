"use client";

import { useEffect, useMemo, useState } from "react";

// Phase 7A/7C: announcement composer. New-draft mode or edit-existing-draft
// mode (controlled by `editingId`). No send / queue / approve buttons —
// those live on the list rows so the composer surface stays single-
// purpose. Submit-for-approval is here because it's the natural last
// step after writing copy.
//
// Phase 7C Steps 1-5: composer accepts three audience modes:
//   • admins                — Phase 7B baseline; only audience the
//                             queue + worker actually unlock today.
//   • provider_category     — dynamic category dropdown from
//                             /api/categories (active only). Queue
//                             still rejects this audience until Step 6.
//   • providers_all         — high-risk broadcast. Composer shows
//                             a red warning banner. Queue still
//                             rejects this audience until Step 8.
//
// Reserved audience values ('all', 'users', 'providers') exist in the
// shared types for future phases but are NOT offered here.

// Full audience union — mirrors AnnouncementAudience in
// lib/announcements/store.ts. The composer offers only three of these
// in its <select>; legacy / reserved values (all, users, providers)
// are persisted in the DB but never selectable here. If an existing
// row arrives via edit-mode with a reserved value, the composer
// preserves it until the admin explicitly changes the dropdown.
export type ComposerAudience =
  | "all"
  | "users"
  | "providers"
  | "admins"
  | "provider_category"
  | "providers_all";

// Narrowed type for the <select> options below.
type AudienceOptionValue =
  | "admins"
  | "provider_category"
  | "providers_all";

export type ComposerDraft = {
  id: string | null;
  title: string;
  body: string;
  target_audience: ComposerAudience;
  target_category: string; // empty string ⇔ null in the DB
  deep_link: string;
};

type RecipientPreview = {
  audience: string;
  total: number;
  by_actor: { users: number; providers: number; admins: number };
  target_category?: string | null;
  providers_in_category?: number | null;
};

type AudienceOption = {
  value: AudienceOptionValue;
  label: string;
};

const AUDIENCE_OPTIONS: ReadonlyArray<AudienceOption> = [
  { value: "admins", label: "Admins only" },
  { value: "provider_category", label: "Providers in category" },
  { value: "providers_all", label: "All providers" },
];

type CategoryListItem = { name: string; active: boolean };

const TITLE_MAX = 65;
const BODY_MAX = 240;
const DEEP_LINK_MAX = 256;

type AnnouncementComposerProps = {
  editingId: string | null;
  initialDraft: ComposerDraft | null;
  onSaved?: () => void;
  onCancelEdit?: () => void;
};

const EMPTY_DRAFT: ComposerDraft = {
  id: null,
  title: "",
  body: "",
  // Phase 7C: default to admins (the only audience the queue+worker
  // currently unlock). Switching to provider_category / providers_all
  // is a deliberate, friction-laden choice.
  target_audience: "admins",
  target_category: "",
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
  // Dynamic category list — fetched from /api/categories on mount.
  // The endpoint already filters to active=true, so the dropdown
  // can't surface disabled categories.
  const [categories, setCategories] = useState<CategoryListItem[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState("");

  // Re-hydrate when parent switches the editing row. Resets preview
  // so the count reflects the new audience selection.
  useEffect(() => {
    setDraft(initialDraft ?? EMPTY_DRAFT);
    setPreview(null);
    setError("");
    setSuccess("");
  }, [editingId, initialDraft]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setCategoriesLoading(true);
      setCategoriesError("");
      try {
        const res = await fetch("/api/categories", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        // /api/categories returns { ok, data, error } today — `data` is
        // an array of { name, active }. Older audits suggested a
        // `categories` key, and some sibling endpoints emit plain
        // string[]. Accept all three shapes so a future API tweak
        // doesn't silently regress this surface again.
        const raw = (await res.json().catch(() => null)) as {
          ok?: boolean;
          data?: unknown;
          categories?: unknown;
          message?: string;
          error?: unknown;
        } | null;
        if (cancelled) return;
        const arrayCandidate = Array.isArray(raw?.data)
          ? raw?.data
          : Array.isArray(raw?.categories)
            ? raw?.categories
            : null;
        if (!res.ok || !arrayCandidate) {
          const errMsg =
            (raw && typeof raw.error === "object" && raw.error !== null
              ? String((raw.error as { message?: unknown }).message ?? "")
              : "") ||
            raw?.message ||
            `Could not load categories (${res.status}).`;
          setCategoriesError(errMsg);
          setCategories([]);
          return;
        }
        const rows = arrayCandidate
          .map((item): CategoryListItem | null => {
            if (typeof item === "string") {
              const name = item.trim();
              return name ? { name, active: true } : null;
            }
            if (item && typeof item === "object") {
              const obj = item as { name?: unknown; active?: unknown };
              const name = String(obj.name ?? "").trim();
              if (!name) return null;
              // /api/categories already filters to active=true, so
              // missing/undefined `active` is treated as true to
              // tolerate both shapes.
              const active =
                obj.active === undefined ? true : Boolean(obj.active);
              return { name, active };
            }
            return null;
          })
          .filter((row): row is CategoryListItem => row !== null)
          .filter((row) => row.active)
          .sort((a, b) =>
            a.name.toLowerCase().localeCompare(b.name.toLowerCase())
          );
        setCategories(rows);
      } catch {
        if (!cancelled) {
          setCategoriesError("Could not load categories.");
          setCategories([]);
        }
      } finally {
        if (!cancelled) setCategoriesLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const titleRemaining = TITLE_MAX - draft.title.length;
  const bodyRemaining = BODY_MAX - draft.body.length;
  const deepLinkRemaining = DEEP_LINK_MAX - draft.deep_link.length;

  const isValid = useMemo(() => {
    if (draft.title.trim().length === 0) return false;
    if (draft.title.length > TITLE_MAX) return false;
    if (draft.body.trim().length === 0) return false;
    if (draft.body.length > BODY_MAX) return false;
    if (draft.deep_link.length > DEEP_LINK_MAX) return false;
    // Phase 7C: provider_category requires a category selection.
    if (draft.target_audience === "provider_category") {
      if (draft.target_category.trim().length === 0) return false;
    }
    return true;
  }, [draft]);

  const audienceLabel =
    AUDIENCE_OPTIONS.find((o) => o.value === draft.target_audience)?.label ??
    draft.target_audience;

  const handleAudienceChange = (next: ComposerAudience) => {
    setDraft((current) => ({
      ...current,
      target_audience: next,
      // Switching away from provider_category clears the category.
      // Switching into provider_category keeps whatever was there.
      target_category:
        next === "provider_category" ? current.target_category : "",
    }));
    // Invalidate the preview — it was computed against the previous
    // audience and might now mislead the type-the-count modal.
    setPreview(null);
  };

  const handleSaveDraft = async () => {
    if (!isValid || saving) return;
    setSaving(true);
    setError("");
    setSuccess("");
    const payload: Record<string, unknown> = {
      title: draft.title.trim(),
      body: draft.body.trim(),
      target_audience: draft.target_audience,
      // target_category is null for admins and providers_all; non-null
      // for provider_category. The store helper + DB CHECK both
      // enforce this consistency.
      target_category:
        draft.target_audience === "provider_category"
          ? draft.target_category.trim()
          : null,
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
            Phase 7C — drafts and approval ready. Sending is unlocked for
            <span className="font-mono"> admins</span> only;{" "}
            <span className="font-mono">provider_category</span> and{" "}
            <span className="font-mono">providers_all</span> queue is still
            blocked.
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
                handleAudienceChange(e.target.value as ComposerAudience)
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

          {/* Phase 7C: conditional category dropdown */}
          {draft.target_audience === "provider_category" ? (
            <label className="block" data-testid="announcement-category-block">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Provider category
              </span>
              {categoriesError ? (
                <p
                  role="alert"
                  className="mt-1 rounded-2xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                >
                  {categoriesError}
                </p>
              ) : null}
              <select
                value={draft.target_category}
                onChange={(e) =>
                  setDraft((current) => ({
                    ...current,
                    target_category: e.target.value,
                  }))
                }
                disabled={categoriesLoading || categories.length === 0}
                data-testid="announcement-category-select"
                className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">
                  {categoriesLoading
                    ? "Loading categories…"
                    : categories.length === 0
                      ? "No active categories"
                      : "Select a category…"}
                </option>
                {categories.map((cat) => (
                  <option key={cat.name} value={cat.name}>
                    {cat.name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                Only canonical, active categories appear. Aliases are not
                broadcast targets.
              </p>
            </label>
          ) : null}

          {/* Phase 7C: red warning banner for the all-providers audience */}
          {draft.target_audience === "providers_all" ? (
            <div
              role="alert"
              data-testid="announcement-providers-all-warning"
              className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900"
            >
              <p className="font-semibold">⚠️ Broadcast to every provider</p>
              <p className="mt-1 text-xs leading-relaxed">
                This audience reaches every registered provider device on
                Kaun Karega across all categories. Sending requires a
                two-field confirmation (type recipient count + type{" "}
                <span className="font-mono">SEND TO ALL PROVIDERS</span>) and
                is still blocked at the queue route in Phase 7C Steps 1-5
                — preview only.
              </p>
            </div>
          ) : null}

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
                <span className="font-mono">{preview.audience}</span>
                {preview.target_category ? (
                  <>
                    {" "}
                    /{" "}
                    <span className="font-mono">{preview.target_category}</span>
                  </>
                ) : null}
                :{" "}
                <span data-testid="announcement-preview-total">
                  {preview.total}
                </span>{" "}
                device{preview.total === 1 ? "" : "s"}
              </p>
              {typeof preview.providers_in_category === "number" ? (
                <p className="mt-1 text-slate-500">
                  Distinct providers in this category:{" "}
                  <span
                    className="font-semibold text-slate-700"
                    data-testid="announcement-preview-providers-in-category"
                  >
                    {preview.providers_in_category}
                  </span>
                </p>
              ) : null}
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
            {draft.target_audience === "provider_category" &&
            draft.target_category ? (
              <>
                {" "}
                / <span className="font-mono">{draft.target_category}</span>
              </>
            ) : null}
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
