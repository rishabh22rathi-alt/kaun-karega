import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { checkAdminByPhone } from "@/lib/adminAuth";
import { canonicalizeProviderAreasToCanonicalNames } from "@/lib/admin/adminAreaMappings";
import { createClient } from "@/lib/supabase/server";
import { appendNotificationLog } from "@/lib/notificationLogStore";
import { sendProviderLeadMessage } from "@/lib/whatsapp-provider";
import { isPushConfigured } from "@/lib/push/firebaseAdmin";
import { getActiveTokensForProviderIds } from "@/lib/push/recipients";
import { newServiceRequestPayload } from "@/lib/push/payloads";
import { sendPushToTokens } from "@/lib/push/sendFcm";
import {
  deactivateInvalidTokens,
  isInvalidTokenError,
} from "@/lib/push/invalidateTokens";
import { appendPushLog, tokenTail } from "@/lib/push/pushLogStore";
import { filterProviderIdsByPreference } from "@/lib/notificationPreferences";

export const runtime = "nodejs";

function extractMessageId(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const messages = (payload as { messages?: Array<{ id?: unknown }> }).messages;
  const firstId = Array.isArray(messages) ? messages[0]?.id : "";
  return String(firstId || "").trim();
}

function normalizePhone10(value: unknown): string {
  return String(value || "").replace(/\D/g, "").slice(-10);
}

// Statuses that indicate the matching/notification pipeline has already run
// for this task. Subsequent calls from owner/admin (without `force=true`)
// short-circuit so a malicious or buggy retry cannot re-send WhatsApp leads.
const TERMINAL_TASK_STATUSES = new Set([
  "notified",
  "provider_responded",
  "no_providers_matched",
  "closed",
  "completed",
]);

export async function POST(request: Request) {
  const routeStartMs = Date.now();

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const taskId =
      typeof body?.taskId === "string" ? body.taskId.trim() : "";
    const forceRequested = body?.force === true;

    if (!taskId) {
      return NextResponse.json({ ok: false, error: "TaskID required" }, { status: 400 });
    }

    // ─── Authorization (A7) ─────────────────────────────────────────────
    // Three accepted paths, in order of preference:
    //   1. Internal server caller — `x-kk-internal-secret` header equals
    //      `process.env.PROCESS_TASK_NOTIFICATIONS_SECRET` (≥ 16 chars).
    //      Bypasses the session check entirely; intended for cron jobs and
    //      same-process retries.
    //   2. Task owner — verified signed `kk_auth_session` cookie whose
    //      phone matches `tasks.phone` for this taskId.
    //   3. Active admin — verified session whose phone is in `admins`
    //      with active=true.
    // Body fields are NEVER consulted to decide ownership. Body fields
    // like `force` are honored only for paths (1) and (3).
    const internalSecretHeader = request.headers.get("x-kk-internal-secret") ?? "";
    const expectedInternalSecret = process.env.PROCESS_TASK_NOTIFICATIONS_SECRET ?? "";
    const isInternalCall =
      expectedInternalSecret.length >= 16 &&
      internalSecretHeader.length >= 16 &&
      internalSecretHeader === expectedInternalSecret;

    let session: Awaited<ReturnType<typeof getAuthSession>> = null;
    if (!isInternalCall) {
      session = await getAuthSession({
        cookie: request.headers.get("cookie") ?? "",
      });
      if (!session) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const reconcileResult = await canonicalizeProviderAreasToCanonicalNames();
    if (!reconcileResult.ok) {
      return NextResponse.json({ ok: false, error: reconcileResult.error }, { status: 500 });
    }

    const supabase = await createClient();

    // 1. Load the task. work_tag is the original alias the user typed when
    // it resolved to a different canonical (e.g. "dentist" -> doctor). Null
    // for canonical / unknown / pre-migration rows — broad matching path
    // handles those exactly like today. `phone` and `status` are needed for
    // the A7 authorization + idempotency checks below.
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("task_id, display_id, category, area, selected_timeframe, work_tag, phone, status")
      .eq("task_id", taskId)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ ok: false, error: "Task not found" }, { status: 404 });
    }

    // ─── Authorization (cont.): owner-or-admin gate ────────────────────
    let isOwner = false;
    let isAdmin = false;
    if (!isInternalCall) {
      const sessionPhone10 = normalizePhone10(session?.phone);
      const taskOwnerPhone10 = normalizePhone10(task.phone);
      isOwner = sessionPhone10.length === 10 && sessionPhone10 === taskOwnerPhone10;
      if (!isOwner && session?.phone) {
        const adminResult = await checkAdminByPhone(session.phone);
        isAdmin = adminResult.ok;
      }
      if (!isOwner && !isAdmin) {
        return NextResponse.json(
          { ok: false, error: "Forbidden: not the task owner" },
          { status: 403 }
        );
      }
    }

    // ─── Idempotency ────────────────────────────────────────────────────
    // If the task has already been processed and the caller has not
    // explicitly opted in to re-sending (admin/internal only), short-circuit.
    // Owners cannot force a resend — this is the path most likely to be
    // weaponized as a WhatsApp-spam vector against matched providers.
    const forceAllowed = isInternalCall || isAdmin;
    const currentStatus = String(task.status || "").trim().toLowerCase();
    if (
      !forceAllowed &&
      currentStatus &&
      TERMINAL_TASK_STATUSES.has(currentStatus)
    ) {
      return NextResponse.json({
        ok: true,
        matchedProviders: 0,
        attemptedSends: 0,
        failedSends: 0,
        matchTier: "category",
        usedFallback: false,
        skipped: true,
        skippedReason: `task already in '${currentStatus}' state`,
      });
    }
    const force = forceAllowed && forceRequested;
    if (
      !force &&
      forceAllowed &&
      currentStatus &&
      TERMINAL_TASK_STATUSES.has(currentStatus)
    ) {
      // Admin/internal hit a terminal task without explicit force=true —
      // also short-circuit. Forces must be intentional.
      return NextResponse.json({
        ok: true,
        matchedProviders: 0,
        attemptedSends: 0,
        failedSends: 0,
        matchTier: "category",
        usedFallback: false,
        skipped: true,
        skippedReason: `task already in '${currentStatus}' state; pass force=true to override`,
      });
    }

    // Gate: only match providers when the task's category exists in the master
    // `categories` table with active = true. Provider rows for unapproved
    // custom categories stay in `provider_services` (so approval auto-enables
    // matching later) but must not generate leads in the meantime.
    // Fail-open on Supabase error: log and continue, so a transient DB blip
    // does not silently drop legitimate leads.
    //
    // Case-insensitive: a task category of "Plumbing" must match a canonical
    // row of "plumbing". `.ilike` handles that without requiring a Postgres
    // trigger or a backfill.
    const { data: categoryRow, error: categoryError } = await supabase
      .from("categories")
      .select("name")
      .ilike("name", String(task.category || ""))
      .eq("active", true)
      .maybeSingle();

    if (categoryError) {
      console.warn(
        "[process-task-notifications] category active-check failed; failing open",
        categoryError.message || categoryError
      );
    } else if (!categoryRow) {
      await supabase
        .from("tasks")
        .update({ status: "no_providers_matched" })
        .eq("task_id", taskId);

      return NextResponse.json({
        ok: true,
        matchedProviders: 0,
        attemptedSends: 0,
        failedSends: 0,
        matchTier: "category",
        usedFallback: false,
      });
    }

    // 2. Find providers matching by category. Use the canonical category
    //    name from the categories row when present so the join key is stable
    //    even if the task was inserted with a different casing.
    const canonicalCategory = String(categoryRow?.name || task.category || "");
    const { data: serviceRows } = await supabase
      .from("provider_services")
      .select("provider_id")
      .ilike("category", canonicalCategory)
      .limit(5000);

    // 3. Find providers matching by area
    const { data: areaRows } = await supabase
      .from("provider_areas")
      .select("provider_id")
      .ilike("area", String(task.area || ""))
      .limit(5000);

    const serviceIds = new Set(
      (serviceRows ?? []).map((r) => String(r.provider_id).trim()).filter(Boolean)
    );
    const areaIds = new Set(
      (areaRows ?? []).map((r) => String(r.provider_id).trim()).filter(Boolean)
    );
    const broadMatched = [...serviceIds].filter((id) => areaIds.has(id));

    // Optional third-axis filter: providers who have claimed task.work_tag
    // under the same canonical category in provider_work_terms. Fail-open
    // on lookup error so a transient DB blip never starves notification
    // fan-out.
    const taskWorkTag = String(task.work_tag || "").trim();
    let workTermIds: Set<string> | null = null;
    if (taskWorkTag) {
      const { data: workTermRows, error: workTermsError } = await supabase
        .from("provider_work_terms")
        .select("provider_id")
        .ilike("alias", taskWorkTag)
        .ilike("canonical_category", canonicalCategory)
        .limit(5000);
      if (workTermsError) {
        console.warn(
          "[process-task-notifications] provider_work_terms lookup failed; falling back to broad",
          workTermsError.message || workTermsError
        );
      } else {
        workTermIds = new Set(
          (workTermRows ?? [])
            .map((row) => String(row.provider_id || "").trim())
            .filter(Boolean)
        );
      }
    }

    let matchedIds: string[];
    let matchTier: "work_tag" | "category_fallback" | "category";
    if (taskWorkTag && workTermIds !== null) {
      const exact = broadMatched.filter((id) => workTermIds!.has(id));
      if (exact.length > 0) {
        matchedIds = exact;
        matchTier = "work_tag";
      } else {
        matchedIds = broadMatched;
        matchTier = "category_fallback";
        console.warn(
          `[process-task-notifications] work_tag "${taskWorkTag}" had no providers under "${canonicalCategory}" in "${task.area}"; fell back to broad canonical — ${broadMatched.length} candidate provider(s)`
        );
      }
    } else if (taskWorkTag) {
      matchedIds = broadMatched;
      matchTier = "category_fallback";
    } else {
      matchedIds = broadMatched;
      matchTier = "category";
    }
    const usedFallback = matchTier === "category_fallback";

    if (matchedIds.length === 0) {
      await supabase
        .from("tasks")
        .update({ status: "no_providers_matched" })
        .eq("task_id", taskId);

      return NextResponse.json({
        ok: true,
        matchedProviders: 0,
        attemptedSends: 0,
        failedSends: 0,
        matchTier,
        usedFallback,
      });
    }

    // 4. Load provider details
    const { data: providers } = await supabase
      .from("providers")
      .select("provider_id, full_name, phone, status")
      .in("provider_id", matchedIds);

    const providerList = (providers ?? []).filter(
      (p) => String(p.status || "").trim().toLowerCase() !== "blocked"
    );

    if (providerList.length === 0) {
      await supabase
        .from("tasks")
        .update({ status: "no_providers_matched" })
        .eq("task_id", taskId);

      return NextResponse.json({
        ok: true,
        matchedProviders: 0,
        attemptedSends: 0,
        failedSends: 0,
        matchTier,
        usedFallback,
      });
    }

    // 5. Send WhatsApp alert to each provider; continue on individual failure
    const kaamLabel = `Kaam No. ${task.display_id}`;
    const serviceTime = String(task.selected_timeframe || "Flexible").trim();
    const templateName = process.env.META_WA_PROVIDER_LEAD_TEMPLATE || "provider_job_alert";
    let failedSends = 0;

    for (const provider of providerList) {
      const providerId = String(provider.provider_id || "").trim();
      const providerPhone = String(provider.phone || "").trim();
      const rawPhone = String(provider.phone || "").replace(/\D/g, "");
      const e164 = rawPhone.startsWith("91") && rawPhone.length === 12
        ? rawPhone
        : `91${rawPhone}`;

      try {
        const sendResult = await sendProviderLeadMessage(
          e164,
          kaamLabel,
          serviceTime,
          task.area,
          `${task.task_id}/${providerId}`
        );
        const logResult = await appendNotificationLog({
          taskId,
          displayId:
            typeof task.display_id === "string" || typeof task.display_id === "number"
              ? String(task.display_id).trim()
              : "",
          providerId,
          providerPhone,
          category: String(task.category || "").trim(),
          area: String(task.area || "").trim(),
          serviceTime,
          templateName,
          status: "accepted",
          statusCode: 200,
          messageId: extractMessageId(sendResult),
          errorMessage: "",
          rawResponse: JSON.stringify(sendResult),
        });
        if (!logResult.ok) {
          console.warn("[process-task-notifications] notification log insert failed", {
            providerId,
            error: logResult.error,
          });
        }
      } catch (sendErr) {
        failedSends += 1;
        console.warn("[process-task-notifications] WhatsApp send failed", {
          providerId,
          error: sendErr instanceof Error ? sendErr.message : sendErr,
        });
        const logResult = await appendNotificationLog({
          taskId,
          displayId:
            typeof task.display_id === "string" || typeof task.display_id === "number"
              ? String(task.display_id).trim()
              : "",
          providerId,
          providerPhone,
          category: String(task.category || "").trim(),
          area: String(task.area || "").trim(),
          serviceTime,
          templateName,
          status: "error",
          statusCode: null,
          messageId: "",
          errorMessage: sendErr instanceof Error ? sendErr.message : String(sendErr),
          rawResponse: sendErr instanceof Error ? sendErr.message : String(sendErr),
        });
        if (!logResult.ok) {
          console.warn("[process-task-notifications] notification log insert failed", {
            providerId,
            error: logResult.error,
          });
        }
      }
    }

    // 6. Upsert provider_task_matches
    const matchRows = providerList.map((p) => ({
      task_id: taskId,
      provider_id: String(p.provider_id).trim(),
      category: task.category,
      area: task.area,
      match_status: "matched",
      notified: true,
    }));

    await supabase
      .from("provider_task_matches")
      .upsert(matchRows, { onConflict: "task_id,provider_id", ignoreDuplicates: false });

    // 6b. Persist per-provider "job_matched" notifications for the bell.
    //     Idempotent — pre-check existing rows so a retry of this route
    //     does not double-notify any provider for the same task. Soft-fail
    //     by design: if the notification insert errors, the matching
    //     pipeline + WhatsApp dispatch above are already done and not
    //     blocked. See provider_notifications schema:
    //     supabase/migrations/20260507120000_alias_review_and_notifications.sql
    //
    //     `toNotify` is hoisted to the outer scope so the §6c native push
    //     block (Phase 4B) can reuse the same dedupe set without a second
    //     round-trip — one source of truth for "who hasn't been told yet".
    let toNotify: string[] = [];
    try {
      const matchedProviderIds = providerList
        .map((p) => String(p.provider_id || "").trim())
        .filter(Boolean);

      if (matchedProviderIds.length > 0) {
        const { data: existingNotifs, error: existingErr } = await supabase
          .from("provider_notifications")
          .select("provider_id, payload_json")
          .eq("type", "job_matched")
          .in("provider_id", matchedProviderIds);

        if (existingErr) {
          console.warn(
            "[process-task-notifications] notif dedupe lookup failed; proceeding without dedupe",
            existingErr.message
          );
        }

        const alreadyNotifiedIds = new Set(
          (existingNotifs || [])
            .filter((row) => {
              const payload = row.payload_json as { taskId?: string } | null;
              return payload?.taskId === taskId;
            })
            .map((row) => String(row.provider_id || ""))
        );

        toNotify = matchedProviderIds.filter(
          (pid) => !alreadyNotifiedIds.has(pid)
        );

        if (toNotify.length > 0) {
          const notifRows = toNotify.map((pid) => ({
            provider_id: pid,
            type: "job_matched",
            title: "New job matched",
            message: `New ${task.category} request in ${task.area}.`,
            href: "/provider/my-jobs",
            payload_json: {
              taskId,
              displayId: (task as { display_id?: unknown }).display_id ?? null,
              category: task.category,
              area: task.area,
              // Additive fields. Older consumers ignore unknown keys; new
              // surfaces (admin dashboards, analytics) can read these to
              // distinguish a precise specialist match from a fallback.
              workTag: taskWorkTag || null,
              matchTier,
              usedFallback,
            },
          }));

          const { error: notifInsertErr } = await supabase
            .from("provider_notifications")
            .insert(notifRows);
          if (notifInsertErr) {
            console.warn(
              "[process-task-notifications] notif insert failed",
              notifInsertErr.message
            );
          }
        }
      }
    } catch (notifErr) {
      console.warn(
        "[process-task-notifications] notification fan-out exception",
        notifErr instanceof Error ? notifErr.message : notifErr
      );
    }

    // 6c. Native push fan-out (Phase 4B).
    //
    //     Reuses the §6b `toNotify` set so a force=true reprocess does not
    //     double-push: if `provider_notifications` already has a row for
    //     (provider_id, task), the provider is not in `toNotify`, and push
    //     skips them.
    //
    //     Soft-fail throughout: WhatsApp, provider_notifications, and the
    //     "tasks.status = notified" update below MUST NOT be affected by
    //     any push error. The whole block is wrapped in a try/catch that
    //     logs and swallows; inner SDK throws, Supabase errors, and per-
    //     token failures all degrade gracefully.
    //
    //     Gating:
    //       1. `NATIVE_PUSH_ENABLED === "true"` — explicit opt-in. Any
    //          other value (unset, "false", "1") leaves the path inert.
    //       2. `isPushConfigured()` — Firebase Admin env present. Without
    //          this we skip silently to preserve the failure mode of
    //          "WhatsApp + bell still fire normally".
    //       3. `toNotify.length > 0` — nothing new to tell anyone.
    try {
      if (
        process.env.NATIVE_PUSH_ENABLED === "true" &&
        isPushConfigured() &&
        toNotify.length > 0
      ) {
        const devices = await getActiveTokensForProviderIds(toNotify);

        // Phase 2: notification preference gate. Filter out providers
        // whose owners have disabled the "job_match" toggle. Fails OPEN —
        // a preference-lookup error returns the full input set, leaves
        // the existing fan-out intact, and writes no preference-disabled
        // log rows for the failed lookup. Soft-fail throughout matches
        // the rest of §6c: a transient prefs error must not regress
        // matched-service push for anyone.
        const prefFilter = await filterProviderIdsByPreference(
          toNotify,
          "job_match"
        );
        if (prefFilter.failedOpen) {
          console.warn(
            "[process-task-notifications] preference filter failed open; sending to all matched providers",
            { taskId, providerCount: toNotify.length }
          );
        }
        const allowedSet = prefFilter.allowed;
        const preferenceDisabledIds = toNotify.filter(
          (pid) => !allowedSet.has(pid)
        );

        // 0. Preference-skipped rows — written BEFORE the no-device
        //    check so a disabled provider does not also get a misleading
        //    "no_active_device" row. Logged with event_type="job_match"
        //    (the preference key) even though the unsent payload would
        //    have used event_type="new_service_request"; this keeps the
        //    push_logs audit per-preference-key so the admin dashboard
        //    can surface "how many providers opted out of job_match for
        //    this task" without joining tables.
        for (const pid of preferenceDisabledIds) {
          const logResult = await appendPushLog({
            eventType: "job_match",
            taskId,
            recipientProviderId: pid,
            status: "skipped",
            errorMessage: "preference_disabled",
            payloadJson: {
              reason: "preference_disabled",
              taskId,
            },
          });
          if (!logResult.ok) {
            console.warn(
              "[process-task-notifications] push_logs (preference_disabled) insert failed",
              { providerId: pid, error: logResult.error }
            );
          }
        }

        // Narrow the device set to allowed providers only. Disabled
        // providers' tokens never reach sendEachForMulticast.
        const allowedDevices = devices.filter(
          (d) => d.providerId !== null && allowedSet.has(d.providerId)
        );

        // Bucket allowed devices by provider so we can both (a) write a
        // 'skipped' log row for allowed providers with zero devices,
        // and (b) attach provider_id to each per-token log row.
        const devicesByProvider = new Map<string, typeof allowedDevices>();
        for (const d of allowedDevices) {
          if (!d.providerId) continue;
          const arr = devicesByProvider.get(d.providerId) ?? [];
          arr.push(d);
          devicesByProvider.set(d.providerId, arr);
        }

        // 1. Skipped rows — one per ALLOWED provider who has no active
        //    device. Preference-disabled providers were already logged
        //    above and are excluded here so they get exactly one
        //    skipped row with the most-specific reason.
        for (const pid of toNotify) {
          if (!allowedSet.has(pid)) continue;
          if (!devicesByProvider.has(pid)) {
            const logResult = await appendPushLog({
              eventType: "new_service_request",
              taskId,
              recipientProviderId: pid,
              status: "skipped",
              errorMessage: "no_active_device",
              payloadJson: {
                reason: "no_active_device",
                taskId,
              },
            });
            if (!logResult.ok) {
              console.warn(
                "[process-task-notifications] push_logs (skipped) insert failed",
                { providerId: pid, error: logResult.error }
              );
            }
          }
        }

        // 2. Send to devices that do exist.
        if (allowedDevices.length > 0) {
          const payload = newServiceRequestPayload({
            taskId,
            displayId: (task as { display_id?: unknown }).display_id ?? null,
            category: String(task.category ?? ""),
            area: String(task.area ?? ""),
            workTag: taskWorkTag || null,
            matchTier,
          });

          let sendResult: Awaited<ReturnType<typeof sendPushToTokens>> | null;
          try {
            sendResult = await sendPushToTokens(
              allowedDevices.map((d) => d.fcmToken),
              payload
            );
          } catch (sendErr) {
            console.warn(
              "[process-task-notifications] sendPushToTokens threw",
              {
                message:
                  sendErr instanceof Error ? sendErr.message : String(sendErr),
                deviceCount: allowedDevices.length,
              }
            );
            sendResult = null;
          }

          if (sendResult) {
            const invalidTokens: string[] = [];
            const deviceByToken = new Map(
              allowedDevices.map((d) => [d.fcmToken, d] as const)
            );
            for (const r of sendResult.results) {
              const device = deviceByToken.get(r.token);
              const status: "sent" | "invalid_token" | "failed" = r.ok
                ? "sent"
                : isInvalidTokenError(r.errorCode)
                  ? "invalid_token"
                  : "failed";
              if (status === "invalid_token") {
                invalidTokens.push(r.token);
              }
              const logResult = await appendPushLog({
                eventType: "new_service_request",
                taskId,
                recipientPhone: device?.phone ?? null,
                recipientProviderId: device?.providerId ?? null,
                fcmTokenTail: tokenTail(r.token),
                status,
                fcmMessageId: r.messageId || null,
                errorCode: r.errorCode || null,
                errorMessage: r.errorMessage || null,
                payloadJson: {
                  eventType: payload.eventType,
                  deepLink: payload.deepLink,
                  taskId,
                },
              });
              if (!logResult.ok) {
                console.warn(
                  "[process-task-notifications] push_logs insert failed",
                  {
                    providerId: device?.providerId ?? null,
                    tokenTail: tokenTail(r.token),
                    error: logResult.error,
                  }
                );
              }
            }
            if (invalidTokens.length > 0) {
              const deact = await deactivateInvalidTokens(invalidTokens);
              if (deact.error) {
                console.warn(
                  "[process-task-notifications] deactivateInvalidTokens failed",
                  { error: deact.error }
                );
              }
            }
          }
        }
      }
    } catch (pushErr) {
      console.warn(
        "[process-task-notifications] native push fan-out exception",
        pushErr instanceof Error ? pushErr.message : pushErr
      );
    }

    // 7. Update task status
    await supabase
      .from("tasks")
      .update({ status: "notified" })
      .eq("task_id", taskId);

    console.log("process-task-notifications complete", {
      taskId,
      matchedCount: providerList.length,
      failedSends,
      matchTier,
      workTag: taskWorkTag || null,
      usedFallback,
      totalElapsedMs: Date.now() - routeStartMs,
    });

    return NextResponse.json({
      ok: true,
      matchedProviders: providerList.length,
      attemptedSends: providerList.length,
      failedSends,
      matchTier,
      usedFallback,
    });

  } catch (error) {
    console.error("process-task-notifications route failed", {
      totalElapsedMs: Date.now() - routeStartMs,
      error: error instanceof Error ? error.message : error,
    });
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Internal Server Error",
      },
      { status: 500 }
    );
  }
}
