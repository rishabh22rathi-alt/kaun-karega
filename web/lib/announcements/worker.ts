// Admin announcement worker — Phase 7B.
//
// Contract: each call to runOnce() processes AT MOST ONE batch and
// returns. A cron / manual invocation drives multiple ticks until the
// job completes. No long-running loops, no streaming responses.
//
// Safety layers (each is independent — bypassing any one still does not
// fire a send):
//   1. ANNOUNCEMENT_SEND_ENABLED env must be exactly "true". Anything
//      else returns { reason: "send_disabled" } without touching FCM.
//   2. isPushConfigured() must be true (Firebase Admin credentials
//      present). Otherwise the job is marked failed with a clear
//      error, no FCM call.
//   3. announcement.target_audience must be 'admins'. Defense in depth
//      — the queue route already blocks others, but the worker
//      re-checks because a row could conceivably be mutated between
//      queue time and tick time.
//   4. announcement.status === 'canceling' → finalize as canceled
//      BEFORE any FCM call.
//   5. Per-token failures soft-fail; the job advances anyway so a
//      single bad token doesn't block the broadcast.

import { adminSupabase } from "@/lib/supabase/admin";
import { isPushConfigured } from "@/lib/push/firebaseAdmin";
import { announcementPayload } from "@/lib/push/payloads";
import { sendPushToTokens } from "@/lib/push/sendFcm";
import {
  deactivateInvalidTokens,
  isInvalidTokenError,
} from "@/lib/push/invalidateTokens";
import { appendPushLog, tokenTail } from "@/lib/push/pushLogStore";
import {
  countRecipients,
  listRecipientsPage,
  type AnnouncementAudience,
} from "./recipients";

// Hard ceiling under FCM's 500 token limit per sendEachForMulticast.
const MAX_BATCH_SIZE = 450;
// Lease window for the worker claim. A crashed worker's claim expires
// after this and the next tick can re-claim the job.
const CLAIM_LEASE_MS = 5 * 60 * 1000;
// Job-level retry cap. Worker abandons after this many failed ticks.
const MAX_ATTEMPTS = 5;

export type WorkerOutcome =
  | { ok: true; status: "send_disabled"; reason: string }
  | { ok: true; status: "no_jobs"; reason: string }
  | { ok: true; status: "audience_blocked"; reason: string; announcementId: string }
  | { ok: true; status: "push_not_configured"; reason: string; announcementId: string }
  | {
      ok: true;
      status: "batch_sent" | "done" | "canceled";
      announcementId: string;
      jobId: string;
      batch: {
        attempted: number;
        sent: number;
        failed: number;
        invalid_token: number;
      };
      cursor: { previous_offset: number; next_offset: number; total: number };
    }
  | {
      ok: true;
      status: "failed";
      announcementId: string;
      jobId: string;
      reason: string;
    };

export type WorkerOptions = {
  // Identifier written into claimed_by for audit. Defaults to "manual".
  workerId?: string;
  // Restrict to a specific job (manual testing path). When unset, the
  // worker pulls the oldest claimable job.
  jobId?: string;
};

type JobRow = {
  id: string;
  announcement_id: string;
  claimed_by: string | null;
  claimed_at: string | null;
  claim_expires_at: string | null;
  next_offset: number;
  batch_size: number;
  total_recipients: number | null;
  status: string;
  attempts: number;
  last_error: string | null;
};

type AnnouncementRow = {
  id: string;
  title: string;
  body: string;
  deep_link: string | null;
  target_audience: AnnouncementAudience;
  status: string;
  recipient_count: number | null;
  sent_count: number | null;
  failed_count: number | null;
  invalid_token_count: number | null;
};

function isSendEnabled(): boolean {
  return process.env.ANNOUNCEMENT_SEND_ENABLED === "true";
}

async function findClaimableJob(jobId?: string): Promise<JobRow | null> {
  const nowIso = new Date().toISOString();
  let query = adminSupabase
    .from("admin_announcement_jobs")
    .select(
      "id, announcement_id, claimed_by, claimed_at, claim_expires_at, next_offset, batch_size, total_recipients, status, attempts, last_error"
    )
    .in("status", ["queued", "processing"])
    .or(`claim_expires_at.is.null,claim_expires_at.lt.${nowIso}`)
    .order("created_at", { ascending: true })
    .limit(1);
  if (jobId) {
    query = query.eq("id", jobId);
  }
  const { data, error } = await query.maybeSingle();
  if (error) {
    console.error("[announcements/worker] findClaimableJob failed", {
      code: error.code,
      message: error.message,
    });
    return null;
  }
  return (data as unknown as JobRow) ?? null;
}

async function claimJob(
  job: JobRow,
  workerId: string
): Promise<JobRow | null> {
  const nowIso = new Date().toISOString();
  const expiresIso = new Date(Date.now() + CLAIM_LEASE_MS).toISOString();
  // Conditional update: only claim if the lease is still open. This
  // re-checks the lease window we just read so two workers racing to
  // claim the same job can't both win.
  let q = adminSupabase
    .from("admin_announcement_jobs")
    .update({
      claimed_by: workerId,
      claimed_at: nowIso,
      claim_expires_at: expiresIso,
      // Bump attempts when transitioning queued → processing on first
      // attempt; bump again when re-claiming after a crash.
      attempts: job.attempts + 1,
      status: job.status === "queued" ? "processing" : job.status,
      updated_at: nowIso,
    })
    .eq("id", job.id);
  if (job.claim_expires_at == null) {
    q = q.is("claim_expires_at", null);
  } else {
    q = q.lt("claim_expires_at", nowIso);
  }
  const { data, error } = await q
    .select(
      "id, announcement_id, claimed_by, claimed_at, claim_expires_at, next_offset, batch_size, total_recipients, status, attempts, last_error"
    )
    .maybeSingle();
  if (error) {
    console.error("[announcements/worker] claimJob failed", {
      jobId: job.id,
      message: error.message,
    });
    return null;
  }
  return (data as unknown as JobRow) ?? null;
}

async function releaseClaim(jobId: string): Promise<void> {
  const nowIso = new Date().toISOString();
  await adminSupabase
    .from("admin_announcement_jobs")
    .update({
      claimed_by: null,
      claimed_at: null,
      claim_expires_at: null,
      updated_at: nowIso,
    })
    .eq("id", jobId);
}

async function loadAnnouncement(
  announcementId: string
): Promise<AnnouncementRow | null> {
  const { data, error } = await adminSupabase
    .from("admin_announcements")
    .select(
      "id, title, body, deep_link, target_audience, status, recipient_count, sent_count, failed_count, invalid_token_count"
    )
    .eq("id", announcementId)
    .maybeSingle();
  if (error) {
    console.error("[announcements/worker] loadAnnouncement failed", {
      announcementId,
      message: error.message,
    });
    return null;
  }
  return (data as unknown as AnnouncementRow) ?? null;
}

async function finalizeAnnouncement(
  announcementId: string,
  patch: Partial<{
    status: string;
    sent_at: string | null;
    canceled_at: string | null;
    failure_reason: string | null;
  }>
): Promise<void> {
  const nowIso = new Date().toISOString();
  await adminSupabase
    .from("admin_announcements")
    .update({ ...patch, updated_at: nowIso })
    .eq("id", announcementId);
}

async function finalizeJob(
  jobId: string,
  status: "done" | "failed",
  lastError: string | null
): Promise<void> {
  const nowIso = new Date().toISOString();
  await adminSupabase
    .from("admin_announcement_jobs")
    .update({
      status,
      last_error: lastError,
      claimed_by: null,
      claimed_at: null,
      claim_expires_at: null,
      updated_at: nowIso,
    })
    .eq("id", jobId);
}

export async function runOnce(
  options: WorkerOptions = {}
): Promise<WorkerOutcome> {
  // ─── 1. Kill switch ────────────────────────────────────────────────
  if (!isSendEnabled()) {
    return {
      ok: true,
      status: "send_disabled",
      reason: "ANNOUNCEMENT_SEND_ENABLED env is not 'true'",
    };
  }

  const workerId =
    String(options.workerId || "").trim() || "manual";

  // ─── 2. Find + claim job ───────────────────────────────────────────
  const candidate = await findClaimableJob(options.jobId);
  if (!candidate) {
    return { ok: true, status: "no_jobs", reason: "No claimable jobs." };
  }
  const job = await claimJob(candidate, workerId);
  if (!job) {
    return { ok: true, status: "no_jobs", reason: "Claim race lost." };
  }

  // From here on, every early return MUST release the claim or
  // finalize the job; otherwise the lease blocks future ticks for
  // CLAIM_LEASE_MS.

  // ─── 3. Load announcement ──────────────────────────────────────────
  const announcement = await loadAnnouncement(job.announcement_id);
  if (!announcement) {
    await finalizeJob(job.id, "failed", "announcement_not_found");
    return {
      ok: true,
      status: "failed",
      announcementId: job.announcement_id,
      jobId: job.id,
      reason: "Announcement row missing for job.",
    };
  }

  // ─── 4. Phase 7B audience hard-block (defense in depth) ────────────
  if (announcement.target_audience !== "admins") {
    await finalizeJob(
      job.id,
      "failed",
      "audience_not_allowed_phase_7b"
    );
    await finalizeAnnouncement(announcement.id, {
      status: "failed",
      failure_reason: "Phase 7B sends to 'admins' audience only.",
    });
    return {
      ok: true,
      status: "audience_blocked",
      announcementId: announcement.id,
      reason:
        "target_audience is not 'admins' — Phase 7B does not unlock other audiences.",
    };
  }

  // ─── 5. Firebase Admin must be configured ──────────────────────────
  if (!isPushConfigured()) {
    // Don't mark the job failed — env may flip in a later tick. Bump
    // attempts to enforce the retry cap and release the claim.
    if (job.attempts >= MAX_ATTEMPTS) {
      await finalizeJob(job.id, "failed", "push_not_configured");
      await finalizeAnnouncement(announcement.id, {
        status: "failed",
        failure_reason: "Firebase Admin is not configured.",
      });
    } else {
      await releaseClaim(job.id);
    }
    return {
      ok: true,
      status: "push_not_configured",
      announcementId: announcement.id,
      reason: "Firebase Admin is not configured in this environment.",
    };
  }

  // ─── 6. Observe cooperative cancel ─────────────────────────────────
  if (announcement.status === "canceling") {
    await finalizeJob(job.id, "done", "canceled_by_admin");
    await finalizeAnnouncement(announcement.id, {
      status: "canceled",
      canceled_at: new Date().toISOString(),
    });
    return {
      ok: true,
      status: "canceled",
      announcementId: announcement.id,
      jobId: job.id,
      batch: { attempted: 0, sent: 0, failed: 0, invalid_token: 0 },
      cursor: {
        previous_offset: job.next_offset,
        next_offset: job.next_offset,
        total: job.total_recipients ?? 0,
      },
    };
  }
  if (
    announcement.status !== "queued" &&
    announcement.status !== "sending"
  ) {
    // Any other status (sent, canceled, failed, approved, draft, etc.)
    // is terminal for the worker. Mark job done and bail.
    await finalizeJob(
      job.id,
      "done",
      `announcement_status_${announcement.status}`
    );
    return {
      ok: true,
      status: "done",
      announcementId: announcement.id,
      jobId: job.id,
      batch: { attempted: 0, sent: 0, failed: 0, invalid_token: 0 },
      cursor: {
        previous_offset: job.next_offset,
        next_offset: job.next_offset,
        total: job.total_recipients ?? 0,
      },
    };
  }

  // ─── 7. First-tick init: seed total_recipients + transition status ─
  let totalRecipients = job.total_recipients;
  if (totalRecipients == null) {
    const countResult = await countRecipients(announcement.target_audience);
    if (!countResult.ok) {
      const reason = `count_failed: ${countResult.error}`;
      if (job.attempts >= MAX_ATTEMPTS) {
        await finalizeJob(job.id, "failed", reason);
        await finalizeAnnouncement(announcement.id, {
          status: "failed",
          failure_reason: reason,
        });
      } else {
        await adminSupabase
          .from("admin_announcement_jobs")
          .update({
            last_error: reason,
            claimed_by: null,
            claimed_at: null,
            claim_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", job.id);
      }
      return {
        ok: true,
        status: "failed",
        announcementId: announcement.id,
        jobId: job.id,
        reason,
      };
    }
    totalRecipients = countResult.total;
    await adminSupabase
      .from("admin_announcement_jobs")
      .update({
        total_recipients: totalRecipients,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    await adminSupabase
      .from("admin_announcements")
      .update({
        recipient_count: totalRecipients,
        status: "sending",
        sending_started_at:
          announcement.status === "queued"
            ? new Date().toISOString()
            : undefined,
        updated_at: new Date().toISOString(),
      })
      .eq("id", announcement.id);
  } else if (announcement.status === "queued") {
    // Defensive: transition to sending if it didn't happen on the
    // count tick (e.g. count succeeded in a prior crash before this
    // status flip).
    await adminSupabase
      .from("admin_announcements")
      .update({
        status: "sending",
        sending_started_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", announcement.id);
  }

  // ─── 8. Already past the end? Finalize as sent. ────────────────────
  if (totalRecipients === 0 || job.next_offset >= totalRecipients) {
    await finalizeJob(job.id, "done", null);
    await finalizeAnnouncement(announcement.id, {
      status: "sent",
      sent_at: new Date().toISOString(),
    });
    return {
      ok: true,
      status: "done",
      announcementId: announcement.id,
      jobId: job.id,
      batch: { attempted: 0, sent: 0, failed: 0, invalid_token: 0 },
      cursor: {
        previous_offset: job.next_offset,
        next_offset: job.next_offset,
        total: totalRecipients,
      },
    };
  }

  // ─── 9. Fetch one batch ────────────────────────────────────────────
  const batchSize = Math.min(MAX_BATCH_SIZE, Math.max(1, job.batch_size));
  const page = await listRecipientsPage(
    announcement.target_audience,
    job.next_offset,
    batchSize
  );
  if (!page.ok) {
    const reason = `page_failed: ${page.error}`;
    if (job.attempts >= MAX_ATTEMPTS) {
      await finalizeJob(job.id, "failed", reason);
      await finalizeAnnouncement(announcement.id, {
        status: "failed",
        failure_reason: reason,
      });
    } else {
      await adminSupabase
        .from("admin_announcement_jobs")
        .update({
          last_error: reason,
          claimed_by: null,
          claimed_at: null,
          claim_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }
    return {
      ok: true,
      status: "failed",
      announcementId: announcement.id,
      jobId: job.id,
      reason,
    };
  }

  const devices = page.devices;
  if (devices.length === 0) {
    // No more devices — finalize.
    await finalizeJob(job.id, "done", null);
    await finalizeAnnouncement(announcement.id, {
      status: "sent",
      sent_at: new Date().toISOString(),
    });
    return {
      ok: true,
      status: "done",
      announcementId: announcement.id,
      jobId: job.id,
      batch: { attempted: 0, sent: 0, failed: 0, invalid_token: 0 },
      cursor: {
        previous_offset: job.next_offset,
        next_offset: job.next_offset,
        total: totalRecipients,
      },
    };
  }

  // ─── 10. Build payload + send ──────────────────────────────────────
  const payload = announcementPayload({
    announcementId: announcement.id,
    title: announcement.title,
    body: announcement.body,
    deepLink: announcement.deep_link ?? "",
    audience: announcement.target_audience,
  });

  let sendResult: Awaited<ReturnType<typeof sendPushToTokens>> | null;
  try {
    sendResult = await sendPushToTokens(
      devices.map((d) => d.fcmToken),
      payload
    );
  } catch (sendErr) {
    const message =
      sendErr instanceof Error ? sendErr.message : String(sendErr);
    console.warn("[announcements/worker] sendPushToTokens threw", {
      jobId: job.id,
      announcementId: announcement.id,
      message,
    });
    const reason = `send_threw: ${message}`;
    if (job.attempts >= MAX_ATTEMPTS) {
      await finalizeJob(job.id, "failed", reason);
      await finalizeAnnouncement(announcement.id, {
        status: "failed",
        failure_reason: reason,
      });
    } else {
      await adminSupabase
        .from("admin_announcement_jobs")
        .update({
          last_error: reason,
          claimed_by: null,
          claimed_at: null,
          claim_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
    }
    return {
      ok: true,
      status: "failed",
      announcementId: announcement.id,
      jobId: job.id,
      reason,
    };
  }

  // ─── 11. Per-token push_logs + invalid-token cleanup ───────────────
  let sent = 0;
  let failed = 0;
  let invalid = 0;
  const invalidTokens: string[] = [];
  const deviceByToken = new Map(
    devices.map((d) => [d.fcmToken, d] as const)
  );

  for (const r of sendResult.results) {
    const device = deviceByToken.get(r.token);
    const status: "sent" | "invalid_token" | "failed" = r.ok
      ? "sent"
      : isInvalidTokenError(r.errorCode)
        ? "invalid_token"
        : "failed";
    if (status === "sent") sent += 1;
    else if (status === "invalid_token") {
      invalid += 1;
      invalidTokens.push(r.token);
    } else failed += 1;

    const logResult = await appendPushLog({
      eventType: "general",
      recipientPhone: device?.phone ?? null,
      recipientProviderId: device?.providerId ?? null,
      fcmTokenTail: tokenTail(r.token),
      status,
      fcmMessageId: r.messageId || null,
      errorCode: r.errorCode || null,
      errorMessage: r.errorMessage || null,
      payloadJson: {
        eventType: "general",
        announcement_id: announcement.id,
        audience: announcement.target_audience,
        deep_link: announcement.deep_link ?? null,
      },
    });
    if (!logResult.ok) {
      console.warn("[announcements/worker] push_logs insert failed", {
        announcementId: announcement.id,
        tokenTail: tokenTail(r.token),
        error: logResult.error,
      });
    }
  }

  if (invalidTokens.length > 0) {
    const deact = await deactivateInvalidTokens(invalidTokens);
    if (deact.error) {
      console.warn(
        "[announcements/worker] deactivateInvalidTokens failed",
        { error: deact.error }
      );
    }
  }

  // ─── 12. Advance cursor + roll up counts ───────────────────────────
  const previousOffset = job.next_offset;
  const newOffset = previousOffset + devices.length;
  const isComplete = newOffset >= totalRecipients;
  const nowIso = new Date().toISOString();

  await adminSupabase
    .from("admin_announcement_jobs")
    .update({
      next_offset: newOffset,
      last_error: null,
      // Release the claim so the next tick can pick it up immediately,
      // even from a different worker.
      claimed_by: null,
      claimed_at: null,
      claim_expires_at: null,
      status: isComplete ? "done" : "processing",
      updated_at: nowIso,
    })
    .eq("id", job.id);

  await adminSupabase
    .from("admin_announcements")
    .update({
      sent_count: (announcement.sent_count ?? 0) + sent,
      failed_count: (announcement.failed_count ?? 0) + failed,
      invalid_token_count:
        (announcement.invalid_token_count ?? 0) + invalid,
      updated_at: nowIso,
      ...(isComplete
        ? { status: "sent", sent_at: nowIso }
        : {}),
    })
    .eq("id", announcement.id);

  return {
    ok: true,
    status: isComplete ? "done" : "batch_sent",
    announcementId: announcement.id,
    jobId: job.id,
    batch: {
      attempted: devices.length,
      sent,
      failed,
      invalid_token: invalid,
    },
    cursor: {
      previous_offset: previousOffset,
      next_offset: newOffset,
      total: totalRecipients,
    },
  };
}
