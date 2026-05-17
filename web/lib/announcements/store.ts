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

export type AnnouncementAudience = "all" | "users" | "providers" | "admins";

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
]);

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
};

export type StoreError = {
  code:
    | "NOT_FOUND"
    | "INVALID_INPUT"
    | "INVALID_TRANSITION"
    | "APPROVAL_SELF"
    | "AUDIENCE_NOT_ALLOWED"
    | "ALREADY_QUEUED"
    | "DB_ERROR";
  message: string;
};

export type StoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StoreError };

const SELECT_COLUMNS =
  "id, title, body, deep_link, target_audience, status, approval_required, " +
  "approved_by_phone, approved_at, queued_at, sending_started_at, sent_at, " +
  "canceled_at, created_by_phone, updated_at, created_at, recipient_count, " +
  "sent_count, failed_count, invalid_token_count, no_active_device_count, " +
  "failure_reason";

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
  deep_link?: unknown;
  approval_required?: unknown;
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
        message: "target_audience must be one of: all, users, providers, admins",
      },
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

  const { data, error } = await adminSupabase
    .from("admin_announcements")
    .insert({
      title,
      body,
      target_audience: input.target_audience,
      deep_link: deepLink,
      approval_required: approvalRequired,
      created_by_phone: createdByPhone,
      // status defaults to 'draft' at the DB layer.
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
  deep_link?: unknown;
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
          message: "target_audience must be one of: all, users, providers, admins",
        },
      };
    }
    patch.target_audience = input.target_audience;
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
// Phase 7B soft-launch hard-blocks every non-admin audience at the
// store layer. The queue route ALSO checks this — defense in depth —
// but a future feature flag that intends to unlock more audiences
// must edit BOTH locations consciously.
const QUEUE_ALLOWED_AUDIENCES: ReadonlySet<AnnouncementAudience> = new Set([
  "admins",
]);

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

  if (!QUEUE_ALLOWED_AUDIENCES.has(existing.value.target_audience)) {
    return {
      ok: false,
      error: {
        code: "AUDIENCE_NOT_ALLOWED",
        message:
          "Phase 7B sends to admin-audience announcements only. Other audiences are not yet unlocked.",
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
};

export async function previewRecipients(
  audience: AnnouncementAudience
): Promise<StoreResult<RecipientPreview>> {
  if (!isValidAudience(audience)) {
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        message: "audience must be one of: all, users, providers, admins",
      },
    };
  }

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

  const total =
    audience === "all"
      ? users + providers + admins
      : audience === "users"
        ? users
        : audience === "providers"
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
