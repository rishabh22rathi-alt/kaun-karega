"use client";

import { useCallback, useEffect, useState } from "react";

import AnnouncementComposer, {
  type ComposerDraft,
} from "@/components/admin/AnnouncementComposer";
import AnnouncementsList, {
  type AnnouncementRow,
} from "@/components/admin/AnnouncementsList";

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
          Compose and approve platform-wide announcements. Phase 7A: drafts
          and approval only — sending is added in Phase 7B.
        </p>
      </header>

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
