"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { X as CloseIcon } from "lucide-react";

// Phase 7D: in-app announcement banner. One client component used by
// both admin and provider surfaces. Talks only to the public banner
// API at /api/announcements/active and /api/announcements/[id]/dismiss
// — does not know about audiences, Supabase, push, or any internal
// admin-announcement field. The API resolves the actor and returns a
// sanitized banner list; this component just renders the top one.
//
// Contract:
//   • Fetches once on mount. No continuous polling (per Phase 7D spec).
//   • Renders the highest-priority banner only.
//   • Optimistic dismiss with rollback on POST failure.
//   • Normal flow at top of content — NOT position-fixed.
//
// Mount sites (Phase 7D.5/7D.6):
//   • web/components/AdminLayoutClient.tsx (admins-audience banners)
//   • web/app/provider/dashboard/page.tsx (provider_category banners)
// Homepage / user dashboard NOT mounted in this phase.

type ActiveBanner = {
  id: string;
  title: string;
  body: string;
  deep_link: string | null;
  cta_label: string | null;
  priority: number;
  dismissible: boolean;
  expires_at: string | null;
};

type ApiResponse = {
  ok?: boolean;
  banners?: ActiveBanner[];
  message?: string;
  error?: string;
};

export default function PlatformAnnouncementBanner() {
  const [banners, setBanners] = useState<ActiveBanner[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [dismissError, setDismissError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/announcements/active", {
          method: "GET",
          credentials: "same-origin",
          cache: "no-store",
        });
        const data = (await res.json().catch(() => null)) as ApiResponse | null;
        if (cancelled) return;
        if (!res.ok || !data?.ok || !Array.isArray(data.banners)) {
          // Silent failure — banner is a soft surface. Don't show
          // an error toast for a missing background fetch.
          setBanners([]);
          return;
        }
        setBanners(data.banners);
      } catch {
        if (!cancelled) setBanners([]);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;
  if (banners.length === 0) return null;

  // Phase 7D V1: render top banner only. API already orders by
  // (priority DESC, created_at DESC) and caps at 5. Stacking deferred.
  const banner = banners[0];

  const handleDismiss = async () => {
    if (dismissingId || !banner.dismissible) return;
    const id = banner.id;
    const previous = banners;
    // Optimistic hide.
    setBanners(banners.slice(1));
    setDismissingId(id);
    setDismissError("");
    try {
      const res = await fetch(
        `/api/announcements/${encodeURIComponent(id)}/dismiss`,
        {
          method: "POST",
          credentials: "same-origin",
        }
      );
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;
      if (!res.ok || !data?.ok) {
        // Rollback: restore the banner + surface a brief error.
        setBanners(previous);
        setDismissError(data?.message || "Could not dismiss banner.");
      }
    } catch {
      setBanners(previous);
      setDismissError("Could not dismiss banner. Check your connection.");
    } finally {
      setDismissingId(null);
    }
  };

  const hasDeepLink =
    typeof banner.deep_link === "string" && banner.deep_link.trim().length > 0;
  const ctaLabel = (banner.cta_label ?? "").trim();

  return (
    <section
      data-testid="platform-announcement-banner"
      className="rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 shadow-sm sm:px-5"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug text-slate-900">
            {banner.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-700">
            {banner.body}
          </p>
          {hasDeepLink && ctaLabel.length > 0 ? (
            <div className="mt-2">
              <Link
                href={banner.deep_link as string}
                data-testid="platform-announcement-banner-cta"
                className="inline-flex items-center rounded-md border border-sky-300 bg-white px-3 py-1 text-xs font-semibold text-sky-800 transition hover:bg-sky-100"
              >
                {ctaLabel}
              </Link>
            </div>
          ) : hasDeepLink ? (
            <p className="mt-1 text-[11px] text-slate-500">
              <Link
                href={banner.deep_link as string}
                className="font-mono text-sky-700 underline decoration-dotted hover:text-sky-900"
                data-testid="platform-announcement-banner-deeplink"
              >
                {banner.deep_link}
              </Link>
            </p>
          ) : null}
          {dismissError ? (
            <p
              role="alert"
              className="mt-2 text-[11px] text-rose-700"
            >
              {dismissError}
            </p>
          ) : null}
        </div>
        {banner.dismissible ? (
          <button
            type="button"
            onClick={handleDismiss}
            disabled={dismissingId === banner.id}
            aria-label="Dismiss banner"
            data-testid="platform-announcement-banner-dismiss"
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-100 disabled:cursor-wait disabled:opacity-50"
          >
            <CloseIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : null}
      </div>
    </section>
  );
}
