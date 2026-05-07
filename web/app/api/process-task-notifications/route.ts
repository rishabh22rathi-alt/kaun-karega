import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { canonicalizeProviderAreasToCanonicalNames } from "@/lib/admin/adminAreaMappings";
import { createClient } from "@/lib/supabase/server";
import { appendNotificationLog } from "@/lib/notificationLogStore";
import { sendProviderLeadMessage } from "@/lib/whatsapp-provider";

function extractMessageId(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const messages = (payload as { messages?: Array<{ id?: unknown }> }).messages;
  const firstId = Array.isArray(messages) ? messages[0]?.id : "";
  return String(firstId || "").trim();
}

export async function POST(request: Request) {
  const routeStartMs = Date.now();

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const taskId =
      typeof body?.taskId === "string" ? body.taskId.trim() : "";

    if (!taskId) {
      return NextResponse.json({ ok: false, error: "TaskID required" }, { status: 400 });
    }

    const session = getAuthSession({
      cookie: request.headers.get("cookie") ?? "",
    });
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const reconcileResult = await canonicalizeProviderAreasToCanonicalNames();
    if (!reconcileResult.ok) {
      return NextResponse.json({ ok: false, error: reconcileResult.error }, { status: 500 });
    }

    const supabase = await createClient();

    // 1. Load the task
    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("task_id, display_id, category, area, selected_timeframe")
      .eq("task_id", taskId)
      .single();

    if (taskError || !task) {
      return NextResponse.json({ ok: false, error: "Task not found" }, { status: 404 });
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
    const matchedIds = [...serviceIds].filter((id) => areaIds.has(id));

    if (matchedIds.length === 0) {
      await supabase
        .from("tasks")
        .update({ status: "no_providers_matched" })
        .eq("task_id", taskId);

      return NextResponse.json({ ok: true, matchedProviders: 0, attemptedSends: 0, failedSends: 0 });
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

        const toNotify = matchedProviderIds.filter(
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

    // 7. Update task status
    await supabase
      .from("tasks")
      .update({ status: "notified" })
      .eq("task_id", taskId);

    console.log("process-task-notifications complete", {
      taskId,
      matchedCount: providerList.length,
      failedSends,
      totalElapsedMs: Date.now() - routeStartMs,
    });

    return NextResponse.json({
      ok: true,
      matchedProviders: providerList.length,
      attemptedSends: providerList.length,
      failedSends,
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
