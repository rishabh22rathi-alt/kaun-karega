// In-app announcement banner helpers — Phase 7D.2.
//
// Read + dismiss surfaces for banners that live on the
// admin_announcements row (banner-specific fields added by the
// Phase 7D.1 migration). This module never touches push state,
// the worker, the queue, notification preferences, or matched-job
// push. Banner emission is independent of push emission.
//
// Audience policy (Phase 7D V1):
//   • admins              — UNLOCKED (admin actors see admin-targeted
//                           banners)
//   • provider_category   — UNLOCKED (provider actors see banners for
//                           categories they offer in provider_services)
//   • providers_all       — BLOCKED (mirrors push policy; not yet
//                           unlocked at the queue side either)
//   • users / all         — BLOCKED (reserved for future phases)
//
// BANNER_ALLOWED_AUDIENCES is intentionally a SEPARATE constant from
// QUEUE_ALLOWED_AUDIENCES in store.ts so a future banner unlock does
// not auto-unlock push for the same audience (or vice versa).

import { adminSupabase } from "@/lib/supabase/admin";
import { getAuthSession } from "@/lib/auth";
import { checkAdminByPhone } from "@/lib/adminAuth";
import { getProviderByPhoneFromSupabase } from "@/lib/admin/adminProviderReads";

// ─── Types ───────────────────────────────────────────────────────────

export type BannerActorType = "user" | "provider" | "admin";

export type ResolvedActor =
  | { ok: true; actorType: BannerActorType; actorKey: string }
  | { ok: false; reason: "unauthenticated" };

// Sanitized shape exposed to clients. Internal columns (target_audience,
// target_category, status, send_push, banner_starts_at, etc.) are
// stripped before this leaves the helper.
export type ActiveBanner = {
  id: string;
  title: string;
  body: string;
  deep_link: string | null;
  cta_label: string | null;
  priority: number;
  dismissible: boolean;
  expires_at: string | null;
};

export type BannerError = {
  code:
    | "NOT_FOUND"
    | "NOT_A_BANNER"
    | "BANNER_NOT_DISMISSIBLE"
    | "NOT_TARGETED"
    | "INVALID_INPUT"
    | "DB_ERROR";
  message: string;
};

export type BannerResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: BannerError };

// ─── Allow-list (BANNER scope; separate from QUEUE scope) ────────────

const BANNER_ALLOWED_AUDIENCES: ReadonlySet<string> = new Set([
  "admins",
  "provider_category",
]);

// Statuses for which a banner is eligible to appear. Drafts and
// pending_approval rows aren't ready; canceled means admin pulled
// the announcement entirely. failed pushes still surface the banner
// because the message may still be relevant even though the push
// didn't land.
const BANNER_ELIGIBLE_STATUSES: ReadonlyArray<string> = [
  "approved",
  "queued",
  "sending",
  "sent",
  "failed",
];

// Hard upper bound on banner rows returned per request. Keeps the
// response small + cache-friendly even before priority dedup.
const BANNER_QUERY_LIMIT = 5;
// Overfetch ceiling: we fetch a few extra rows then JS-filter for
// timing windows + dismissals. With show_as_banner=true being rare
// and the partial index keeping scans small, this stays cheap.
const BANNER_OVERFETCH_LIMIT = 50;

// ─── Phone canonicalization ──────────────────────────────────────────
//
// admin / user actor keys are stored as canonical 12-digit
// "91XXXXXXXXXX" — same convention as notification_preferences and
// native_push_devices. getAuthSession.phone is already canonical from
// the OTP login flow; re-canonicalize defensively so a stray session
// shape never produces an actor_key mismatch with stored dismissals.
function canonicalizePhone(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length > 10) return `91${digits.slice(-10)}`;
  return "";
}

// Defensive UUID format check before any DB lookup keyed by id. The
// dismiss route accepts an [id] segment from the URL; an attacker
// passing a SQL-shaped string is rejected here rather than leaking
// any Supabase parse-error detail.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

// ─── Actor resolution ────────────────────────────────────────────────
//
// Resolution priority: admin → provider → user. An admin who is also
// a registered provider resolves as 'admin' — they see admin banners,
// not provider_category banners. This matches the notification-
// preference model where admins have their own preference scope
// separate from any provider account they may also own.

export async function resolveBannerActor(
  request: Request
): Promise<ResolvedActor> {
  const cookieHeader = request.headers.get("cookie") || "";
  const session = await getAuthSession({
    cookie: cookieHeader,
    validateVersion: true,
  });
  if (!session?.phone) {
    return { ok: false, reason: "unauthenticated" };
  }

  const sessionPhone = String(session.phone).trim();
  const canonicalPhone = canonicalizePhone(sessionPhone);

  // 1. Admin?
  try {
    const adminCheck = await checkAdminByPhone(sessionPhone);
    if (adminCheck.ok) {
      const phone = canonicalizePhone(adminCheck.admin.phone) || canonicalPhone;
      if (phone) {
        return { ok: true, actorType: "admin", actorKey: phone };
      }
    }
  } catch {
    // checkAdminByPhone is supposed to never throw, but defend.
  }

  // 2. Provider?
  try {
    const providerLookup = await getProviderByPhoneFromSupabase(sessionPhone);
    if (providerLookup.ok) {
      const providerId = String(
        providerLookup.provider.ProviderID ?? ""
      ).trim();
      if (providerId.length > 0) {
        return { ok: true, actorType: "provider", actorKey: providerId };
      }
    }
  } catch {
    // Fall through to user.
  }

  // 3. User fallback. user actor type is not unlocked for banners in
  //    Phase 7D V1, but we still resolve so dismiss() can return
  //    NOT_TARGETED rather than 401 for logged-in non-targeted users.
  if (canonicalPhone) {
    return { ok: true, actorType: "user", actorKey: canonicalPhone };
  }
  return { ok: false, reason: "unauthenticated" };
}

// ─── Read: active banners for actor ──────────────────────────────────

type RawBannerRow = {
  id: string;
  title: string;
  body: string;
  deep_link: string | null;
  banner_cta_label: string | null;
  banner_priority: number | null;
  banner_dismissible: boolean | null;
  banner_starts_at: string | null;
  banner_expires_at: string | null;
  target_audience: string;
  target_category: string | null;
  created_at: string;
};

const BANNER_SELECT_COLUMNS =
  "id, title, body, deep_link, banner_cta_label, banner_priority, " +
  "banner_dismissible, banner_starts_at, banner_expires_at, " +
  "target_audience, target_category, created_at";

function withinBannerWindow(row: RawBannerRow, now: Date): boolean {
  if (row.banner_starts_at) {
    const startsAt = Date.parse(row.banner_starts_at);
    if (!Number.isNaN(startsAt) && startsAt > now.getTime()) return false;
  }
  if (row.banner_expires_at) {
    const expiresAt = Date.parse(row.banner_expires_at);
    if (!Number.isNaN(expiresAt) && expiresAt <= now.getTime()) return false;
  }
  return true;
}

function sanitizeBanner(row: RawBannerRow): ActiveBanner {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    body: String(row.body ?? ""),
    deep_link: row.deep_link ?? null,
    cta_label: row.banner_cta_label ?? null,
    priority: Number(row.banner_priority ?? 0),
    dismissible: row.banner_dismissible !== false,
    expires_at: row.banner_expires_at ?? null,
  };
}

// Fetch the actor's dismissed announcement_ids once and re-use across
// the audience-specific filter. One round trip; bounded by however
// many banners the actor has dismissed (typically a handful).
async function fetchActorDismissedIds(
  actorType: BannerActorType,
  actorKey: string
): Promise<Set<string>> {
  const { data, error } = await adminSupabase
    .from("announcement_dismissals")
    .select("announcement_id")
    .eq("actor_type", actorType)
    .eq("actor_key", actorKey);
  if (error) {
    console.warn("[announcements/banners] dismissals fetch failed", {
      actorType,
      message: error.message,
    });
    return new Set();
  }
  return new Set(
    (data ?? []).map((row) =>
      String((row as { announcement_id?: unknown }).announcement_id ?? "")
    )
  );
}

async function fetchProviderCategoriesLower(
  providerId: string
): Promise<Set<string>> {
  const { data, error } = await adminSupabase
    .from("provider_services")
    .select("category")
    .eq("provider_id", providerId);
  if (error) {
    console.warn("[announcements/banners] provider_services fetch failed", {
      providerId,
      message: error.message,
    });
    return new Set();
  }
  return new Set(
    (data ?? [])
      .map((row) =>
        String((row as { category?: unknown }).category ?? "")
          .trim()
          .toLowerCase()
      )
      .filter((c) => c.length > 0)
  );
}

export async function listActiveBannersForActor(
  actorType: BannerActorType,
  actorKey: string
): Promise<BannerResult<ActiveBanner[]>> {
  if (!actorKey || actorKey.length === 0) {
    return { ok: true, value: [] };
  }

  // Phase 7D V1: 'user' actor has no banner audience yet. Return
  // empty list rather than 4xx so the homepage can call this freely.
  if (actorType === "user") {
    return { ok: true, value: [] };
  }

  if (actorType === "admin") {
    const [bannersRes, dismissedIds] = await Promise.all([
      adminSupabase
        .from("admin_announcements")
        .select(BANNER_SELECT_COLUMNS)
        .eq("show_as_banner", true)
        .in("status", BANNER_ELIGIBLE_STATUSES)
        .eq("target_audience", "admins")
        .order("banner_priority", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(BANNER_OVERFETCH_LIMIT),
      fetchActorDismissedIds(actorType, actorKey),
    ]);

    if (bannersRes.error) {
      return {
        ok: false,
        error: { code: "DB_ERROR", message: bannersRes.error.message },
      };
    }

    const now = new Date();
    const filtered = ((bannersRes.data ?? []) as unknown as RawBannerRow[])
      .filter((row) => BANNER_ALLOWED_AUDIENCES.has(row.target_audience))
      .filter((row) => withinBannerWindow(row, now))
      .filter((row) => !dismissedIds.has(row.id))
      .slice(0, BANNER_QUERY_LIMIT)
      .map(sanitizeBanner);

    return { ok: true, value: filtered };
  }

  // actorType === "provider"
  const [bannersRes, dismissedIds, providerCategoriesLower] = await Promise.all([
    adminSupabase
      .from("admin_announcements")
      .select(BANNER_SELECT_COLUMNS)
      .eq("show_as_banner", true)
      .in("status", BANNER_ELIGIBLE_STATUSES)
      .eq("target_audience", "provider_category")
      .order("banner_priority", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(BANNER_OVERFETCH_LIMIT),
    fetchActorDismissedIds(actorType, actorKey),
    fetchProviderCategoriesLower(actorKey),
  ]);

  if (bannersRes.error) {
    return {
      ok: false,
      error: { code: "DB_ERROR", message: bannersRes.error.message },
    };
  }

  if (providerCategoriesLower.size === 0) {
    // Provider has no provider_services rows → no category-targeted
    // banner can possibly match. Return empty without iterating rows.
    return { ok: true, value: [] };
  }

  const now = new Date();
  const filtered = ((bannersRes.data ?? []) as unknown as RawBannerRow[])
    .filter((row) => BANNER_ALLOWED_AUDIENCES.has(row.target_audience))
    .filter((row) => {
      const cat = String(row.target_category ?? "").trim().toLowerCase();
      return cat.length > 0 && providerCategoriesLower.has(cat);
    })
    .filter((row) => withinBannerWindow(row, now))
    .filter((row) => !dismissedIds.has(row.id))
    .slice(0, BANNER_QUERY_LIMIT)
    .map(sanitizeBanner);

  return { ok: true, value: filtered };
}

// ─── Dismiss ─────────────────────────────────────────────────────────

// Returns true if the actor is in the announcement's target audience.
// 'admins' audience requires actor_type='admin'. 'provider_category'
// requires actor_type='provider' AND the provider offers
// target_category. Anything else is NOT_TARGETED.
async function isActorTargeted(
  actorType: BannerActorType,
  actorKey: string,
  row: Pick<RawBannerRow, "target_audience" | "target_category">
): Promise<boolean> {
  if (!BANNER_ALLOWED_AUDIENCES.has(row.target_audience)) return false;
  if (row.target_audience === "admins") {
    return actorType === "admin";
  }
  if (row.target_audience === "provider_category") {
    if (actorType !== "provider") return false;
    const targetCat = String(row.target_category ?? "").trim().toLowerCase();
    if (!targetCat) return false;
    const providerCategories = await fetchProviderCategoriesLower(actorKey);
    return providerCategories.has(targetCat);
  }
  return false;
}

export async function dismissBanner(
  announcementId: string,
  actorType: BannerActorType,
  actorKey: string
): Promise<BannerResult<{ dismissed: true }>> {
  if (!isUuid(announcementId)) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "Invalid announcement id." },
    };
  }
  if (!actorKey || actorKey.length === 0) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "Actor key is required." },
    };
  }

  // Load the announcement + banner gates. The columns we read here
  // are the bare minimum needed to decide: existence, banner flag,
  // dismissibility, and audience. status is not read because dismiss
  // is allowed even for sent/failed banners (admin may want them
  // gone after they served their purpose).
  const { data, error } = await adminSupabase
    .from("admin_announcements")
    .select(
      "id, show_as_banner, banner_dismissible, target_audience, target_category"
    )
    .eq("id", announcementId)
    .maybeSingle();

  if (error) {
    return {
      ok: false,
      error: { code: "DB_ERROR", message: error.message },
    };
  }
  if (!data) {
    return {
      ok: false,
      error: { code: "NOT_FOUND", message: "Announcement not found." },
    };
  }

  const row = data as unknown as {
    id: string;
    show_as_banner: boolean | null;
    banner_dismissible: boolean | null;
    target_audience: string;
    target_category: string | null;
  };

  if (row.show_as_banner !== true) {
    return {
      ok: false,
      error: {
        code: "NOT_A_BANNER",
        message: "This announcement is not surfaced as a banner.",
      },
    };
  }
  if (row.banner_dismissible !== true) {
    return {
      ok: false,
      error: {
        code: "BANNER_NOT_DISMISSIBLE",
        message: "This banner cannot be dismissed.",
      },
    };
  }

  const targeted = await isActorTargeted(actorType, actorKey, row);
  if (!targeted) {
    return {
      ok: false,
      error: {
        code: "NOT_TARGETED",
        message: "This banner is not targeted at the current actor.",
      },
    };
  }

  // ON CONFLICT DO NOTHING — second dismiss is a no-op, not an error.
  // upsert() with ignoreDuplicates=true maps to ON CONFLICT DO NOTHING
  // in Supabase JS.
  const { error: insertErr } = await adminSupabase
    .from("announcement_dismissals")
    .upsert(
      {
        announcement_id: row.id,
        actor_type: actorType,
        actor_key: actorKey,
      },
      {
        onConflict: "announcement_id,actor_type,actor_key",
        ignoreDuplicates: true,
      }
    );

  if (insertErr) {
    return {
      ok: false,
      error: { code: "DB_ERROR", message: insertErr.message },
    };
  }

  return { ok: true, value: { dismissed: true } };
}
