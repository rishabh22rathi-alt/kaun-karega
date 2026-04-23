/**
 * Backend-native admin reminder helper.
 *
 * Preserves the current remind action contract used by the admin dashboard:
 *   POST /api/kk { action: "remind_providers", taskId }
 *   -> { ok, status, taskId, matchedProviders, placeholderNotificationTriggered, reminderAt }
 *
 * Proven GAS behavior from Tasks.js:remindProviders_():
 *   - ensure provider matches exist if absent
 *   - set task status to "notified"
 *   - return reminder metadata
 *
 * This helper intentionally does not add WhatsApp delivery or notification-log
 * side effects. Those are not provable from remindProviders_() itself and remain
 * deferred to a later slice.
 */

import { adminSupabase } from "../supabase/admin";

type ReminderTaskRow = {
  task_id: string;
  category: string | null;
  area: string | null;
};

type ExistingMatchRow = {
  provider_id: string;
};

type ProviderIdRow = {
  provider_id: string;
};

export type AdminReminderResult =
  | {
      ok: true;
      status: "success";
      taskId: string;
      matchedProviders: number;
      placeholderNotificationTriggered: true;
      reminderAt: string;
    }
  | {
      ok: false;
      status: "error";
      error: string;
    };

export async function remindProvidersForTask(taskId: string): Promise<AdminReminderResult> {
  try {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      return { ok: false, status: "error", error: "TaskID required" };
    }

    const { data: task, error: taskError } = await adminSupabase
      .from("tasks")
      .select("task_id, category, area")
      .eq("task_id", normalizedTaskId)
      .single();

    if (taskError || !task) {
      return { ok: false, status: "error", error: "Task not found" };
    }

    const taskRow = task as ReminderTaskRow;

    const { data: existingMatches, error: existingMatchesError } = await adminSupabase
      .from("provider_task_matches")
      .select("provider_id")
      .eq("task_id", normalizedTaskId);

    if (existingMatchesError) {
      return { ok: false, status: "error", error: existingMatchesError.message };
    }

    let matchedProviderIds = (existingMatches ?? [])
      .map((row) => String((row as ExistingMatchRow).provider_id || "").trim())
      .filter(Boolean);

    if (matchedProviderIds.length === 0) {
      const [{ data: serviceRows, error: servicesError }, { data: areaRows, error: areasError }] =
        await Promise.all([
          adminSupabase
            .from("provider_services")
            .select("provider_id")
            .eq("category", String(taskRow.category || "").trim())
            .limit(200),
          adminSupabase
            .from("provider_areas")
            .select("provider_id")
            .eq("area", String(taskRow.area || "").trim())
            .limit(200),
        ]);

      if (servicesError) {
        return { ok: false, status: "error", error: servicesError.message };
      }
      if (areasError) {
        return { ok: false, status: "error", error: areasError.message };
      }

      const serviceIds = new Set(
        (serviceRows ?? [])
          .map((row) => String((row as ProviderIdRow).provider_id || "").trim())
          .filter(Boolean)
      );
      const areaIds = new Set(
        (areaRows ?? [])
          .map((row) => String((row as ProviderIdRow).provider_id || "").trim())
          .filter(Boolean)
      );

      matchedProviderIds = [...serviceIds].filter((providerId) => areaIds.has(providerId));

      if (matchedProviderIds.length > 0) {
        const matchRows = matchedProviderIds.map((providerId) => ({
          task_id: normalizedTaskId,
          provider_id: providerId,
          category: String(taskRow.category || "").trim(),
          area: String(taskRow.area || "").trim(),
          match_status: "matched",
          notified: true,
        }));

        const { error: upsertError } = await adminSupabase
          .from("provider_task_matches")
          .upsert(matchRows, { onConflict: "task_id,provider_id", ignoreDuplicates: false });

        if (upsertError) {
          return { ok: false, status: "error", error: upsertError.message };
        }
      }
    }

    const { error: updateError } = await adminSupabase
      .from("tasks")
      .update({ status: "notified" })
      .eq("task_id", normalizedTaskId);

    if (updateError) {
      return { ok: false, status: "error", error: updateError.message };
    }

    return {
      ok: true,
      status: "success",
      taskId: normalizedTaskId,
      matchedProviders: matchedProviderIds.length,
      placeholderNotificationTriggered: true,
      reminderAt: new Date().toISOString(),
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
