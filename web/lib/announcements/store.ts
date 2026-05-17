// Admin announcements store — Phase 7A.
//
// Centralized helpers for the admin_announcements lifecycle. No FCM
// import, no worker, no queue — Phase 7B owns those. This module
// reaches at most the 'approved' state.
//
// All state transitions are written as conditional UPDATEs scoped by
// `.eq("status", expectedStatus)` so concurrent submits from two
// tabs race-safely: only one wins, the other gets ok:false.

import { adminSupabase } from "@/lib/supabase/admin";

// Audience discriminators understood by the store. The DB CHECK in
// admin_announcements mirrors this set verbatim — keep them in sync.
//
// 'provider_category' carries a non-null target_category (canonical
// categories.name string). Every other audience carries NULL
// target_category; the DB cross-column CHECK enforces this.
//
// Phase 7C Step 1-5 widens this UNION but DOES NOT add the new values
// to QUEUE_ALLOWED_AUDIENCES below — the queue path still rejects
// provider_category and providers_all. Sending unlocks come in
// Phase 7C Step 6 (queue) and Step 7 (worker).
export type AnnouncementAudience =
  | "all"
  | "users"
  | "providers"
  | "admins"
  | "provider_category"
  | "providers_all";

export type AnnouncementStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "queued"
  | "sending"
  | "canceling"
  | "sent"
  | "canceled"
  | "failed";

const AUDIENCE_SET: ReadonlySet<AnnouncementAudience> = new Set([
  "all",
  "users",
  "providers",
  "admins",
  "provider_category",
  "providers_all",
]);

export type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  deep_link: string | null;
  target_audience: AnnouncementAudience;
  // Phase 7C: canonical categories.name when target_audience =
  // 'provider_category'; NULL for every other audience. The DB
  // cross-column CHECK enforces consistency.
  target_category: string | null;
  status: AnnouncementStatus;
  approval_required: boolean;
  approved_by_phone: string | null;
  approved_at: string | null;
  queued_at: string | null;
  sending_started_at: string | null;
  sent_at: string | null;
  canceled_at: string | null;
  created_by_phone: string;
  updated_at: string;
  created_at: string;
  recipient_count: number | null;
  sent_count: number | null;
  failed_count: number | null;
  invalid_token_count: number | null;
  no_active_device_count: number | null;
  failure_reason: string | null;
  // Phase 7D: banner surface fields. send_push defaults true so
  // existing rows keep their Phase 7B/7C push-only behavior.
  send_push: boolean;
  show_as_banner: boolean;
  banner_priority: number;
  banner_starts_at: string | null;
  banner_expires_at: string | null;
  banner_dismissible: boolean;
  banner_cta_label: string | null;
};

export type StoreError = {
  code:
    | "NOT_FOUND"
    | "INVALID_INPUT"
    | "INVALID_TRANSITION"
    | "APPROVAL_SELF"
    | "AUDIENCE_NOT_ALLOWED"
    | "ALREADY_QUEUED"
    // Phase 7C: queue-time category validation failures.
    | "TARGET_CATEGORY_REQUIRED"
    | "TARGET_CATEGORY_INACTIVE"
    | "RECIPIENT_LIMIT_EXCEEDED"
    | "DB_ERROR";
  message: string;
};

export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StoreError };

const SELECT_COLUMNS =
  "id, title, body, deep_link, target_audience, target_category, status, " +
  "approval_required, approved_by_phone, approved_at, queued_at, " +
  "sending_started_at, sent_at, canceled_at, created_by_phone, " +
  "updated_at, created_at, recipient_count, sent_count, failed_count, " +
  "invalid_token_count, no_active_device_count, failure_reason, " +
  // Phase 7D: banner surface columns.
  "send_push, show_as_banner, banner_priority, banner_starts_at, " +
  "banner_expires_at, banner_dismissible, banner_cta_label";

// ─── Validation helpers ─────────────────────────────────────────────

export function isValidAudience(value: unknown): value is AnnouncementAudience {
  return typeof value === "string" && AUDIENCE_SET.has(value as AnnouncementAudience);
}

function trimToLength(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) return null;
  return trimmed;
}

function trimOptional(value: unknown, max: number): string | null | "invalid" {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return "invalid";
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) return "invalid";
  return trimmed;
}

// Phase 7D: resolve banner-related fields to a typed, validated set
// or a single error message. Mirrors the four DB cross-column CHECKs
// added by 20260522120000_admin_announcements_banner.sql:
//   1. send_push OR show_as_banner must be true
//   2. banner timing fields require show_as_banner=true
//   3. banner_starts_at < banner_expires_at (when both set)
//   4. banner_cta_label requires deep_link
//
// When show_as_banner is false, every banner field except send_push
// is normalized to its inert default (priority=0, starts/expires=null,
// dismissible=true, cta_label=null). The DB CHECK on
// admin_announcements_banner_timing_requires_banner would otherwise
// reject non-null timing fields on a non-banner row.
type BannerFieldSet = {
  send_push: boolean;
  show_as_banner: boolean;
  banner_priority: number;
  banner_starts_at: string | null;
  banner_expires_at: string | null;
  banner_dismissible: boolean;
  banner_cta_label: string | null;
};

type BannerFieldsInput = {
  send_push?: unknown;
  show_as_banner?: unknown;
  banner_priority?: unknown;
  banner_starts_at?: unknown;
  banner_expires_at?: unknown;
  banner_dismissible?: unknown;
  banner_cta_label?: unknown;
};

function coerceBooleanWithDefault(
  raw: unknown,
  fallback: boolean
): boolean | null {
  if (raw === undefined) return fallback;
  if (typeof raw === "boolean") return raw;
  // Reject ambiguous strings/numbers — surface INVALID_INPUT instead
  // of silently coercing. Tests assert this.
  return null;
}

function coerceIsoTimestamp(raw: unknown): string | null | "invalid" {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string") return "invalid";
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  // Date.parse accepts ISO 8601; tolerate "YYYY-MM-DDTHH:mm" from
  // the composer's datetime-local input.
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return "invalid";
  return new Date(parsed).toISOString();
}

function resolveBannerFields(
  input: BannerFieldsInput,
  effectiveDeepLink: string | null
): { ok: true; value: BannerFieldSet } | { ok: false; message: string } {
  const sendPush = coerceBooleanWithDefault(input.send_push, true);
  if (sendPush === null) {
    return { ok: false, message: "send_push must be a boolean" };
  }
  const showBanner = coerceBooleanWithDefault(input.show_as_banner, false);
  if (showBanner === null) {
    return { ok: false, message: "show_as_banner must be a boolean" };
  }

  // Gate 1: at least one emission surface.
  if (!sendPush && !showBanner) {
    return {
      ok: false,
      message:
        "At least one of send_push or show_as_banner must be true. An announcement that does nothing is rejected.",
    };
  }

  // Banner-off short-circuit: ignore (and normalize away) every banner
  // field. The DB CHECK enforces this; we ensure the row we insert
  // satisfies it rather than relying on Supabase to reject after a
  // round-trip.
  if (!showBanner) {
    if (
      input.banner_starts_at !== undefined ||
      input.banner_expires_at !== undefined
    ) {
      const starts = coerceIsoTimestamp(input.banner_starts_at);
      const expires = coerceIsoTimestamp(input.banner_expires_at);
      // Be strict: a UI that sends timing fields while show_as_banner
      // is off is a bug. Reject so admins don't silently lose values.
      if (
        (starts !== null && starts !== "invalid" && starts !== undefined) ||
        (expires !== null && expires !== "invalid" && expires !== undefined)
      ) {
        return {
          ok: false,
          message:
            "Banner timing fields require show_as_banner=true.",
        };
      }
    }
    if (
      typeof input.banner_cta_label === "string" &&
      input.banner_cta_label.trim().length > 0
    ) {
      return {
        ok: false,
        message: "banner_cta_label requires show_as_banner=true.",
      };
    }
    return {
      ok: true,
      value: {
        send_push: sendPush,
        show_as_banner: false,
        banner_priority: 0,
        banner_starts_at: null,
        banner_expires_at: null,
        // Default true matches the DB column default; the value is
        // irrelevant for non-banner rows but normalize for consistency.
        banner_dismissible: true,
        banner_cta_label: null,
      },
    };
  }

  // show_as_banner === true from here on.

  // banner_priority (integer; default 0)
  let priority = 0;
  if (input.banner_priority !== undefined) {
    if (typeof input.banner_priority === "number") {
      if (!Number.isFinite(input.banner_priority) ||
          !Number.isInteger(input.banner_priority)) {
        return {
          ok: false,
          message: "banner_priority must be a finite integer",
        };
      }
      priority = input.banner_priority;
    } else if (typeof input.banner_priority === "string") {
      const parsed = Number.parseInt(input.banner_priority, 10);
      if (!Number.isFinite(parsed)) {
        return {
          ok: false,
          message: "banner_priority must be a finite integer",
        };
      }
      priority = parsed;
    } else {
      return {
        ok: false,
        message: "banner_priority must be a number",
      };
    }
  }

  const starts = coerceIsoTimestamp(input.banner_starts_at);
  if (starts === "invalid") {
    return { ok: false, message: "banner_starts_at must be a valid ISO timestamp" };
  }
  const expires = coerceIsoTimestamp(input.banner_expires_at);
  if (expires === "invalid") {
    return { ok: false, message: "banner_expires_at must be a valid ISO timestamp" };
  }

  // Gate 3: time window sanity.
  if (starts && expires && Date.parse(starts) >= Date.parse(expires)) {
    return {
      ok: false,
      message: "banner_starts_at must be strictly before banner_expires_at",
    };
  }

  const dismissible = coerceBooleanWithDefault(input.banner_dismissible, true);
  if (dismissible === null) {
    return { ok: false, message: "banner_dismissible must be a boolean" };
  }

  // banner_cta_label optional, 1-40 chars when set, REQUIRES deep_link.
  let ctaLabel: string | null = null;
  if (input.banner_cta_label !== undefined && input.banner_cta_label !== null) {
    if (typeof input.banner_cta_label !== "string") {
      return { ok: false, message: "banner_cta_label must be a string" };
    }
    const trimmed = input.banner_cta_label.trim();
    if (trimmed.length > 0) {
      if (trimmed.length > 40) {
        return {
          ok: false,
          message: "banner_cta_label must be 1-40 characters",
        };
      }
      // Gate 4: CTA label requires deep_link.
      if (!effectiveDeepLink || effectiveDeepLink.trim().length === 0) {
        return {
          ok: false,
          message: "banner_cta_label requires deep_link to be set",
        };
      }
      ctaLabel = trimmed;
    }
  }

  return {
    ok: true,
    value: {
      send_push: sendPush,
      show_as_banner: true,
      banner_priority: priority,
      banner_starts_at: starts,
      banner_expires_at: expires,
      banner_dismissible: dismissible,
      banner_cta_label: ctaLabel,
    },
  };
}

// Phase 7C: resolve the (audience, target_category) pair to a single
// canonical value or a validation error. Mirrors the DB cross-column
// CHECK so we surface a 400 INVALID_INPUT before hitting Supabase:
//
//   provider_category  ⇒ target_category required (1-120 chars)
//   anything else      ⇒ target_category MUST be null (any non-null
//                        input is rejected to prevent a stray value
//                        from leaking in via a future code path)
function resolveTargetCategory(
  audience: AnnouncementAudience,
  raw: unknown
): { ok: true; value: string | null } | { ok: false; message: string } {
  if (audience === "provider_category") {
    if (typeof raw !== "string") {
      return {
        ok: false,
        message:
          "target_category is required (1-120 chars) when target_audience='provider_category'",
      };
    }
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed.length > 120) {
      return {
        ok: false,
        message:
          "target_category must be 1-120 chars when target_audience='provider_category'",
      };
    }
    return { ok: true, value: trimmed };
  }
  // Non-category audience: target_category MUST be null/empty. Any
  // accidental string would violate the DB consistency CHECK.
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "string" && raw.trim().length === 0) {
    return { ok: true, value: null };
  }
  return {
    ok: false,
    message: `target_category must be empty when target_audience='${audience}'`,
  };
}

// ─── Reads ───────────────────────────────────────────────────────────

export type ListOptions = {
  status?: AnnouncementStatus | null;
  limit?: number;
  offset?: number;
};

export async function listAnnouncements(
  options: ListOptions = {}
): Promise<StoreResult<AnnouncementRow[]>> {
  const limit = Math.max(1, Math.min(200, options.limit ?? 50));
  const offset = Math.max(0, options.offset ?? 0);

  let query = adminSupabase
    .from("admin_announcements")
    .select(SELECT_COLUMNS)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  if (error) {
    return {
      ok: false,
      error: { code: "DB_ERROR", message: error.message },
    };
  }
  return { ok: true, value: (data ?? []) as unknown as AnnouncementRow[] };
}

export async function getAnnouncementById(
  id: string
): Promise<StoreResult<AnnouncementRow>> {
  const trimmed = String(id ?? "").trim();
  if (!trimmed) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "id is required" },
    };
  }
  const { data, error } = await adminSupabase
    .from("admin_announcements")
    .select(SELECT_COLUMNS)
    .eq("id", trimmed)
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
      error: { code: "NOT_FOUND", message: "Announcement not found" },
    };
  }
  return { ok: true, value: data as unknown as AnnouncementRow };
}

// ─── Writes ──────────────────────────────────────────────────────────

export type CreateDraftInput = {
  title: unknown;
  body: unknown;
  target_audience: unknown;
  // Phase 7C: required when target_audience='provider_category', must
  // be null/undefined for every other audience. Validated via
  // resolveTargetCategory() and additionally by the DB cross-column
  // CHECK.
  target_category?: unknown;
  deep_link?: unknown;
  approval_required?: unknown;
  // Phase 7D: banner surface fields. send_push defaults true so
  // omitting these keeps existing push-only Phase 7B/7C behavior.
  send_push?: unknown;
  show_as_banner?: unknown;
  banner_priority?: unknown;
  banner_starts_at?: unknown;
  banner_expires_at?: unknown;
  banner_dismissible?: unknown;
  banner_cta_label?: unknown;
  created_by_phone: string;
};

export async function createAnnouncementDraft(
  input: CreateDraftInput
): Promise<StoreResult<AnnouncementRow>> {
  const title = trimToLength(input.title, 65);
  if (!title) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "title is required (1-65 chars)",
      },
    };
  }
  const body = trimToLength(input.body, 240);
  if (!body) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "body is required (1-240 chars)",
      },
    };
  }
  if (!isValidAudience(input.target_audience)) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message:
          "target_audience must be one of: all, users, providers, admins, provider_category, providers_all",
      },
    };
  }
  const targetCategoryResult = resolveTargetCategory(
    input.target_audience,
    input.target_category
  );
  if (!targetCategoryResult.ok) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: targetCategoryResult.message },
    };
  }
  const deepLink = trimOptional(input.deep_link, 256);
  if (deepLink === "invalid") {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "deep_link must be a string of <= 256 chars",
      },
    };
  }
  const createdByPhone = String(input.created_by_phone ?? "").trim();
  if (!createdByPhone) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "created_by_phone is required",
      },
    };
  }
  const approvalRequired =
    typeof input.approval_required === "boolean"
      ? input.approval_required
      : false;

  // Phase 7D: validate banner fields against the four DB CHECK
  // constraints before INSERT so a 400 surfaces with the specific
  // failure message instead of a generic Supabase error.
  const bannerResult = resolveBannerFields(
    {
      send_push: input.send_push,
      show_as_banner: input.show_as_banner,
      banner_priority: input.banner_priority,
      banner_starts_at: input.banner_starts_at,
      banner_expires_at: input.banner_expires_at,
      banner_dismissible: input.banner_dismissible,
      banner_cta_label: input.banner_cta_label,
    },
    deepLink
  );
  if (!bannerResult.ok) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: bannerResult.message },
    };
  }

  const { data, error } = await adminSupabase
    .from("admin_announcements")
    .insert({
      title,
      body,
      target_audience: input.target_audience,
      target_category: targetCategoryResult.value,
      deep_link: deepLink,
      approval_required: approvalRequired,
      created_by_phone: createdByPhone,
      // status defaults to 'draft' at the DB layer.
      send_push: bannerResult.value.send_push,
      show_as_banner: bannerResult.value.show_as_banner,
      banner_priority: bannerResult.value.banner_priority,
      banner_starts_at: bannerResult.value.banner_starts_at,
      banner_expires_at: bannerResult.value.banner_expires_at,
      banner_dismissible: bannerResult.value.banner_dismissible,
      banner_cta_label: bannerResult.value.banner_cta_label,
    })
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return {
      ok: false,
      error: { code: "DB_ERROR", message: error.message },
    };
  }
  return { ok: true, value: data as unknown as AnnouncementRow };
}

export type UpdateDraftInput = {
  title?: unknown;
  body?: unknown;
  target_audience?: unknown;
  // Phase 7C. When audience is being changed, the EFFECTIVE pair
  // (new audience, new target_category) is what gets validated —
  // see updateAnnouncementDraft body.
  target_category?: unknown;
  deep_link?: unknown;
  // Phase 7D: banner surface fields. Same effective-pair pattern —
  // if ANY banner field is being updated, the WHOLE banner set is
  // re-validated against the effective audience + deep_link.
  send_push?: unknown;
  show_as_banner?: unknown;
  banner_priority?: unknown;
  banner_starts_at?: unknown;
  banner_expires_at?: unknown;
  banner_dismissible?: unknown;
  banner_cta_label?: unknown;
};

export async function updateAnnouncementDraft(
  id: string,
  input: UpdateDraftInput
): Promise<StoreResult<AnnouncementRow>> {
  const existing = await getAnnouncementById(id);
  if (!existing.ok) return existing;
  if (existing.value.status !== "draft") {
    return {
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "Only draft announcements can be edited.",
      },
    };
  }

  const patch: Record<string, unknown> = {};
  if (input.title !== undefined) {
    const title = trimToLength(input.title, 65);
    if (!title) {
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "title must be 1-65 chars",
        },
      };
    }
    patch.title = title;
  }
  if (input.body !== undefined) {
    const body = trimToLength(input.body, 240);
    if (!body) {
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "body must be 1-240 chars",
        },
      };
    }
    patch.body = body;
  }
  if (input.target_audience !== undefined) {
    if (!isValidAudience(input.target_audience)) {
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message:
            "target_audience must be one of: all, users, providers, admins, provider_category, providers_all",
        },
      };
    }
    patch.target_audience = input.target_audience;
  }
  // Phase 7C: re-validate target_category against the EFFECTIVE
  // audience whenever either field is in the patch. Changing audience
  // away from 'provider_category' without setting target_category to
  // null would violate the DB consistency CHECK, so we resolve it
  // explicitly here.
  if (
    input.target_audience !== undefined ||
    input.target_category !== undefined
  ) {
    const effectiveAudience =
      (input.target_audience as AnnouncementAudience | undefined) ??
      existing.value.target_audience;
    const rawCategory =
      input.target_category !== undefined
        ? input.target_category
        : existing.value.target_category;
    const categoryResult = resolveTargetCategory(effectiveAudience, rawCategory);
    if (!categoryResult.ok) {
      return {
        ok: false,
        error: { code: "INVALID_INPUT", message: categoryResult.message },
      };
    }
    patch.target_category = categoryResult.value;
  }
  if (input.deep_link !== undefined) {
    const deepLink = trimOptional(input.deep_link, 256);
    if (deepLink === "invalid") {
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message: "deep_link must be a string of <= 256 chars",
        },
      };
    }
    patch.deep_link = deepLink;
  }

  // Phase 7D: re-validate banner fields whenever ANY banner field is
  // in the patch, OR when deep_link is being changed (because the CTA
  // label gate depends on deep_link). Uses the EFFECTIVE pair —
  // anything not in the patch falls back to the existing row.
  const bannerFieldKeys: ReadonlyArray<keyof UpdateDraftInput> = [
    "send_push",
    "show_as_banner",
    "banner_priority",
    "banner_starts_at",
    "banner_expires_at",
    "banner_dismissible",
    "banner_cta_label",
  ];
  const anyBannerFieldTouched = bannerFieldKeys.some(
    (k) => input[k] !== undefined
  );
  if (anyBannerFieldTouched || input.deep_link !== undefined) {
    const effectiveDeepLink =
      input.deep_link !== undefined
        ? (patch.deep_link as string | null)
        : existing.value.deep_link;
    const bannerInput: BannerFieldsInput = {
      send_push:
        input.send_push !== undefined
          ? input.send_push
          : existing.value.send_push,
      show_as_banner:
        input.show_as_banner !== undefined
          ? input.show_as_banner
          : existing.value.show_as_banner,
      banner_priority:
        input.banner_priority !== undefined
          ? input.banner_priority
          : existing.value.banner_priority,
      banner_starts_at:
        input.banner_starts_at !== undefined
          ? input.banner_starts_at
          : existing.value.banner_starts_at,
      banner_expires_at:
        input.banner_expires_at !== undefined
          ? input.banner_expires_at
          : existing.value.banner_expires_at,
      banner_dismissible:
        input.banner_dismissible !== undefined
          ? input.banner_dismissible
          : existing.value.banner_dismissible,
      banner_cta_label:
        input.banner_cta_label !== undefined
          ? input.banner_cta_label
          : existing.value.banner_cta_label,
    };
    const bannerResult = resolveBannerFields(bannerInput, effectiveDeepLink);
    if (!bannerResult.ok) {
      return {
        ok: false,
        error: { code: "INVALID_INPUT", message: bannerResult.message },
      };
    }
    patch.send_push = bannerResult.value.send_push;
    patch.show_as_banner = bannerResult.value.show_as_banner;
    patch.banner_priority = bannerResult.value.banner_priority;
    patch.banner_starts_at = bannerResult.value.banner_starts_at;
    patch.banner_expires_at = bannerResult.value.banner_expires_at;
    patch.banner_dismissible = bannerResult.value.banner_dismissible;
    patch.banner_cta_label = bannerResult.value.banner_cta_label;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: true, value: existing.value };
  }

  patch.updated_at = new Date().toISOString();

  const { data, error } = await adminSupabase
    .from("admin_announcements")
    .update(patch)
    .eq("id", id)
    .eq("status", "draft") // race-safe: another submitter cannot have advanced state
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return {
      ok: false,
      error: { code: "DB_ERROR", message: error.message },
    };
  }
  if (!data) {
    // Row exists but status moved between our check and the conditional
    // UPDATE — treat as a transition error.
    return {
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "Announcement is no longer in draft state.",
      },
    };
  }
  return { ok: true, value: data as unknown as AnnouncementRow };
}

export async function deleteAnnouncementDraft(
  id: string
): Promise<StoreResult<{ id: string }>> {
  const existing = await getAnnouncementById(id);
  if (!existing.ok) return existing;
  if (existing.value.status !== "draft") {
    return {
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "Only draft announcements can be deleted.",
      },
    };
  }
  const { error, data } = await adminSupabase
    .from("admin_announcements")
    .delete()
    .eq("id", id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: { code: "DB_ERROR", message: error.message } };
  }
  if (!data) {
    return {
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "Announcement is no longer in draft state.",
      },
    };
  }
  return { ok: true, value: { id } };
}

// Submit a draft. If approval_required=false → straight to 'approved'.
// If approval_required=true → 'pending_approval'. Race-safe transition
// scoped to .eq("status", "draft") so concurrent submits from two tabs
// resolve to a single winner.
export async function submitAnnouncement(
  id: string,
  actorPhone: string
): Promise<StoreResult<AnnouncementRow>> {
  const existing = await getAnnouncementById(id);
  if (!existing.ok) return existing;
  if (existing.value.status !== "draft") {
    return {
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: `Cannot submit announcement in status '${existing.value.status}'.`,
      },
    };
  }

  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {
    updated_at: nowIso,
  };

  if (existing.value.approval_required) {
    patch.status = "pending_approval";
  } else {
    patch.status = "approved";
    // Self-approval is allowed only when approval_required=false, in
    // which case the trigger does not enforce the creator≠approver
    // rule. Stamp the actor anyway for audit symmetry.
    patch.approved_by_phone = String(actorPhone || "").trim() || null;
    patch.approved_at = nowIso;
  }

  const { data, error } = await adminSupabase
    .from("admin_announcements")
    .update(patch)
    .eq("id", id)
    .eq("status", "draft")
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    return { ok: false, error: { code: "DB_ERROR", message: error.message } };
  }
  if (!data) {
    return {
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "Announcement is no longer in draft state.",
      },
    };
  }
  return { ok: true, value: data as unknown as AnnouncementRow };
}

// Approve a pending_approval announcement. Enforces creator≠approver
// at the API layer when approval_required=true (the DB trigger is the
// canonical gate). Race-safe via .eq("status", "pending_approval").
export async function approveAnnouncement(
  id: string,
  actorPhone: string
): Promise<StoreResult<AnnouncementRow>> {
  const trimmedActor = String(actorPhone || "").trim();
  if (!trimmedActor) {
    return {
      ok: false,
      error: { code: "INVALID_INPUT", message: "approver phone is required" },
    };
  }
  const existing = await getAnnouncementById(id);
  if (!existing.ok) return existing;
  if (existing.value.status !== "pending_approval") {
    return {
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: `Cannot approve announcement in status '${existing.value.status}'.`,
      },
    };
  }
  if (
    existing.value.approval_required &&
    existing.value.created_by_phone === trimmedActor
  ) {
    return {
      ok: false,
      error: {
        code: "APPROVAL_SELF",
        message: "Announcement cannot be approved by its creator.",
      },
    };
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await adminSupabase
    .from("admin_announcements")
    .update({
      status: "approved",
      approved_by_phone: trimmedActor,
      approved_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)
    .eq("status", "pending_approval")
    .select(SELECT_COLUMNS)
    .single();

  if (error) {
    // The DB trigger raises SQLSTATE 23514 when approval_required=true
    // and approver=creator. Surface as APPROVAL_SELF so the route
    // returns a 400 instead of a 500.
    if ((error as { code?: string }).code === "23514") {
      return {
        ok: false,
        error: {
          code: "APPROVAL_SELF",
          message: "Announcement cannot be approved by its creator.",
        },
      };
    }
    return { ok: false, error: { code: "DB_ERROR", message: error.message } };
  }
  if (!data) {
    return {
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "Announcement is no longer in pending_approval state.",
      },
    };
  }
  return { ok: true, value: data as unknown as AnnouncementRow };
}

// ─── Queue + cancel (Phase 7B) ──────────────────────────────────────
//
// Phase 7C Step 6: queue is now unlocked for 'admins' AND
// 'provider_category'. 'providers_all' remains blocked here AND in
// the worker — both layers must be updated in lockstep when product
// approves the all-providers unlock (Phase 7C Step 8).
//
// Legacy reserved values ('all', 'users', 'providers') remain
// blocked. Adding any of them to this set requires a conscious code
// change here AND in worker.ts AND ideally an audit checklist for
// the safety friction (count-confirm modal, recipient cap env).
const QUEUE_ALLOWED_AUDIENCES: ReadonlySet<AnnouncementAudience> = new Set([
  "admins",
  "provider_category",
]);

// Phase 7C Step 6 introduced a temporary recipient cap for
// provider_category broadcasts during soft launch. Phase 7E removed
// the cap — sends now go to the full eligible audience by default.
// The `ANNOUNCEMENT_PHASE_7C_MAX_RECIPIENTS_CATEGORY` env var is no
// longer read anywhere and is safe to delete from Vercel.
//
// RECIPIENT_LIMIT_EXCEEDED stays in StoreError["code"] for one
// release cycle so any client that imported the union doesn't break;
// no code path emits it anymore.

// Re-validate the row's target_category against the canonical
// categories table. Used at queue time to catch the race where a
// category was disabled (or renamed) between draft save and Queue
// Send. Case-insensitive via .ilike, matching the matched-job push
// flow's normalization.
async function isTargetCategoryActive(
  targetCategory: string
): Promise<{ ok: true; active: boolean } | { ok: false; error: string }> {
  const trimmed = targetCategory.trim();
  if (!trimmed) return { ok: true, active: false };
  const { data, error } = await adminSupabase
    .from("categories")
    .select("name")
    .ilike("name", trimmed)
    .eq("active", true)
    .maybeSingle();
  if (error) {
    return { ok: false, error: error.message };
  }
  return { ok: true, active: !!data };
}

export type QueueAnnouncementResult = {
  announcement: AnnouncementRow;
  jobCreated: boolean;
};

// Transition: approved → queued. Audience hard-block: only 'admins'
// in Phase 7B. Creates a corresponding admin_announcement_jobs row;
// the unique(announcement_id) constraint guarantees one job per
// announcement even under concurrent queue clicks.
export async function queueAnnouncement(
  id: string
): Promise<StoreResult<QueueAnnouncementResult>> {
  const existing = await getAnnouncementById(id);
  if (!existing.ok) return existing;

  // Audience hard-block — Phase 7C allows 'admins' + 'provider_category'.
  // providers_all stays blocked here until Phase 7C Step 8.
  if (!QUEUE_ALLOWED_AUDIENCES.has(existing.value.target_audience)) {
    return {
      ok: false,
      error: {
        code: "AUDIENCE_NOT_ALLOWED",
        message:
          "Phase 7C sends to 'admins' and 'provider_category' audiences only. 'providers_all' is not yet unlocked.",
      },
    };
  }

  if (existing.value.status === "queued" || existing.value.status === "sending") {
    return {
      ok: false,
      error: {
        code: "ALREADY_QUEUED",
        message: `Announcement is already ${existing.value.status}.`,
      },
    };
  }
  if (existing.value.status !== "approved") {
    return {
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: `Cannot queue announcement in status '${existing.value.status}'.`,
      },
    };
  }

  // Phase 7C Step 6: per-audience pre-queue validation. Runs BEFORE
  // the announcement-row UPDATE so a rejection leaves the row in
  // 'approved' state and the admin can retry cleanly.
  if (existing.value.target_audience === "provider_category") {
    const targetCategory = String(existing.value.target_category ?? "").trim();
    if (!targetCategory) {
      // DB cross-column CHECK should make this unreachable, but
      // surface it explicitly so a future schema regression doesn't
      // silently leak a NULL target_category into the worker.
      return {
        ok: false,
        error: {
          code: "TARGET_CATEGORY_REQUIRED",
          message:
            "target_category is required when target_audience='provider_category'.",
        },
      };
    }
    const activeCheck = await isTargetCategoryActive(targetCategory);
    if (!activeCheck.ok) {
      return {
        ok: false,
        error: {
          code: "DB_ERROR",
          message: `Failed to validate target_category: ${activeCheck.error}`,
        },
      };
    }
    if (!activeCheck.active) {
      return {
        ok: false,
        error: {
          code: "TARGET_CATEGORY_INACTIVE",
          message: `Category '${targetCategory}' is not active or no longer exists. Please update the draft.`,
        },
      };
    }
    // Phase 7E: recipient cap removed. provider_category sends now
    // go to every active provider device matching the category. The
    // recipient preview shown in the composer is the admin-side
    // visibility gate; backend trust is provided by the audience
    // hard-block and the active-category check above.
  }

  const nowIso = new Date().toISOString();

  // Race-safe transition: only flips when current status is still
  // 'approved'. Concurrent queue clicks resolve to one winner.
  const { data: updated, error: updateErr } = await adminSupabase
    .from("admin_announcements")
    .update({
      status: "queued",
      queued_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", id)
    .eq("status", "approved")
    .select(SELECT_COLUMNS)
    .single();

  if (updateErr) {
    return {
      ok: false,
      error: { code: "DB_ERROR", message: updateErr.message },
    };
  }
  if (!updated) {
    return {
      ok: false,
      error: {
        code: "INVALID_TRANSITION",
        message: "Announcement is no longer in approved state.",
      },
    };
  }

  // Phase 7D banner-only path: when send_push=false, the worker has
  // nothing to do — there's no FCM to dispatch. Skip the job-row
  // INSERT entirely. The announcement.status transition above is
  // sufficient to make the banner visible (BANNER_ELIGIBLE_STATUSES
  // in banners.ts includes 'queued'). For push+banner rows
  // (send_push=true AND show_as_banner=true) the job row is still
  // created and the worker handles the push half normally.
  if (existing.value.send_push !== true) {
    return {
      ok: true,
      value: {
        announcement: updated as unknown as AnnouncementRow,
        jobCreated: false,
      },
    };
  }

  // Insert the job row. unique(announcement_id) guarantees idempotency
  // against double-clicks across tabs. If the row exists already
  // (shouldn't, because we just transitioned from 'approved'), treat
  // as a race-win and proceed.
  const { error: jobErr } = await adminSupabase
    .from("admin_announcement_jobs")
    .insert({
      announcement_id: id,
      status: "queued",
      next_offset: 0,
    });

  if (jobErr) {
    const code = (jobErr as { code?: string }).code ?? "";
    if (code !== "23505") {
      // Roll back the announcement.status transition so the admin
      // can retry once the underlying issue is resolved.
      await adminSupabase
        .from("admin_announcements")
        .update({
          status: "approved",
          queued_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("status", "queued");
      return {
        ok: false,
        error: {
          code: "DB_ERROR",
          message: `Failed to create job row: ${jobErr.message}`,
        },
      };
    }
  }

  return {
    ok: true,
    value: {
      announcement: updated as unknown as AnnouncementRow,
      jobCreated: !jobErr,
    },
  };
}

export type CancelAnnouncementResult = {
  announcement: AnnouncementRow;
  // True when the cancel was terminal (no worker action needed); false
  // when the announcement was moved to 'canceling' awaiting the worker.
  immediate: boolean;
};

// Cancel an in-flight or queued announcement.
//   queued     → canceled (terminal; job → done)
//   sending    → canceling (worker observes and finalizes)
//   canceling  → no-op (already in canceling)
//   anything else → INVALID_TRANSITION
export async function cancelAnnouncement(
  id: string
): Promise<StoreResult<CancelAnnouncementResult>> {
  const existing = await getAnnouncementById(id);
  if (!existing.ok) return existing;

  if (existing.value.status === "canceling") {
    return {
      ok: true,
      value: { announcement: existing.value, immediate: false },
    };
  }
  if (existing.value.status === "canceled") {
    return {
      ok: true,
      value: { announcement: existing.value, immediate: true },
    };
  }

  const nowIso = new Date().toISOString();

  if (existing.value.status === "queued") {
    // Terminal cancel — no worker has touched it yet.
    const { data: updated, error: updateErr } = await adminSupabase
      .from("admin_announcements")
      .update({
        status: "canceled",
        canceled_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", id)
      .eq("status", "queued")
      .select(SELECT_COLUMNS)
      .single();
    if (updateErr) {
      return {
        ok: false,
        error: { code: "DB_ERROR", message: updateErr.message },
      };
    }
    if (!updated) {
      return {
        ok: false,
        error: {
          code: "INVALID_TRANSITION",
          message: "Announcement state changed before cancel could apply.",
        },
      };
    }
    // Mark job done so the worker won't try to pick it up.
    await adminSupabase
      .from("admin_announcement_jobs")
      .update({
        status: "done",
        last_error: "canceled_before_start",
        updated_at: nowIso,
      })
      .eq("announcement_id", id)
      .in("status", ["queued", "processing"]);
    return {
      ok: true,
      value: {
        announcement: updated as unknown as AnnouncementRow,
        immediate: true,
      },
    };
  }

  if (existing.value.status === "sending") {
    // Cooperative cancel — worker observes on next tick.
    const { data: updated, error: updateErr } = await adminSupabase
      .from("admin_announcements")
      .update({
        status: "canceling",
        updated_at: nowIso,
      })
      .eq("id", id)
      .eq("status", "sending")
      .select(SELECT_COLUMNS)
      .single();
    if (updateErr) {
      return {
        ok: false,
        error: { code: "DB_ERROR", message: updateErr.message },
      };
    }
    if (!updated) {
      return {
        ok: false,
        error: {
          code: "INVALID_TRANSITION",
          message: "Announcement state changed before cancel could apply.",
        },
      };
    }
    return {
      ok: true,
      value: {
        announcement: updated as unknown as AnnouncementRow,
        immediate: false,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: "INVALID_TRANSITION",
      message: `Cannot cancel announcement in status '${existing.value.status}'.`,
    },
  };
}

// ─── Recipient preview ──────────────────────────────────────────────
//
// Returns COUNTS ONLY. Never returns tokens, phones, provider_ids, or
// any other identifying info — admins seeing this preview must not
// be able to enumerate recipients. The three counts come from a
// parallel `count: 'exact', head: true` against native_push_devices
// filtered by active=true and the actor_type buckets.

export type RecipientPreview = {
  total: number;
  by_actor: {
    users: number;
    providers: number;
    admins: number;
  };
  audience: AnnouncementAudience;
  // Phase 7C: present only when audience='provider_category'.
  target_category?: string | null;
  // Phase 7C diagnostic, present only when audience='provider_category':
  // distinct provider count derived from provider_services. Lets the
  // admin understand "21 providers offer this service, of which N have
  // active devices = total".
  providers_in_category?: number;
};

// Phase 7C: signature now optionally takes targetCategory. Required
// when audience='provider_category', ignored for other audiences.
//
// COUNTS ONLY. Never returns tokens, phones, provider_ids, or any
// other identifying info. The native_push_devices counts use
// `count: 'exact', head: true` so zero data rows are transferred.
export async function previewRecipients(
  audience: AnnouncementAudience,
  targetCategory?: string | null
): Promise<StoreResult<RecipientPreview>> {
  if (!isValidAudience(audience)) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message:
          "audience must be one of: all, users, providers, admins, provider_category, providers_all",
      },
    };
  }

  // Per-actor-type global counts. Drive the by_actor breakdown for
  // every audience and the total for audiences not scoped to a
  // specific category.
  const buildCount = (actorType: "user" | "provider" | "admin") =>
    adminSupabase
      .from("native_push_devices")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .eq("actor_type", actorType);

  const [userRes, providerRes, adminRes] = await Promise.all([
    buildCount("user"),
    buildCount("provider"),
    buildCount("admin"),
  ]);

  const firstError =
    userRes.error ?? providerRes.error ?? adminRes.error ?? null;
  if (firstError) {
    return {
      ok: false,
      error: { code: "DB_ERROR", message: firstError.message },
    };
  }

  const users = Number(userRes.count ?? 0);
  const providers = Number(providerRes.count ?? 0);
  const admins = Number(adminRes.count ?? 0);

  // Phase 7C: provider_category audience does a two-step join. Step
  // 1: SELECT DISTINCT provider_id FROM provider_services WHERE
  // category ILIKE <target>. Step 2: count active provider devices
  // for those provider_ids. Counts only — no token/phone/provider_id
  // leaves this function in the response.
  if (audience === "provider_category") {
    const trimmed = String(targetCategory ?? "").trim();
    if (!trimmed) {
      return {
        ok: false,
        error: {
          code: "INVALID_INPUT",
          message:
            "target_category required for audience='provider_category' preview",
        },
      };
    }
    const { data: services, error: servicesErr } = await adminSupabase
      .from("provider_services")
      .select("provider_id")
      .ilike("category", trimmed);
    if (servicesErr) {
      return {
        ok: false,
        error: { code: "DB_ERROR", message: servicesErr.message },
      };
    }
    const providerIds = Array.from(
      new Set(
        (services ?? [])
          .map((row) => String((row as { provider_id?: unknown }).provider_id ?? "").trim())
          .filter((s) => s.length > 0)
      )
    );
    if (providerIds.length === 0) {
      return {
        ok: true,
        value: {
          total: 0,
          by_actor: { users, providers, admins },
          audience,
          target_category: trimmed,
          providers_in_category: 0,
        },
      };
    }
    const { count: deviceCount, error: deviceErr } = await adminSupabase
      .from("native_push_devices")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .eq("actor_type", "provider")
      .in("provider_id", providerIds);
    if (deviceErr) {
      return {
        ok: false,
        error: { code: "DB_ERROR", message: deviceErr.message },
      };
    }
    return {
      ok: true,
      value: {
        total: Number(deviceCount ?? 0),
        by_actor: { users, providers, admins },
        audience,
        target_category: trimmed,
        providers_in_category: providerIds.length,
      },
    };
  }

  // Non-category audiences: pick the right slice of the global counts.
  const total =
    audience === "all"
      ? users + providers + admins
      : audience === "users"
        ? users
        : audience === "providers" || audience === "providers_all"
          ? providers
          : admins;

  return {
    ok: true,
    value: {
      total,
      by_actor: { users, providers, admins },
      audience,
    },
  };
}
