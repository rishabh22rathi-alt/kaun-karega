/**
 * Backend-native admin task read helper.
 *
 * Preserves the existing `get_admin_requests` / `admin_get_requests`
 * response contract as closely as possible while sourcing data from
 * Supabase instead of Google Apps Script.
 *
 * Tables used:
 *   - tasks
 *   - provider_task_matches
 *   - providers
 *
 * Schema prerequisite carried forward from Slice 11:
 *   ALTER TABLE tasks ADD COLUMN IF NOT EXISTS assigned_provider_id TEXT;
 *   ALTER TABLE tasks ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
 */

import { adminSupabase } from "../supabase/admin";

type MatchedProviderDetail = {
  ProviderID: string;
  ProviderName: string;
  ProviderPhone: string;
  Verified: string;
  OtpVerified: string;
  OtpVerifiedAt: string;
  PendingApproval: string;
  ResponseStatus: string;
  CreatedAt: string;
  AcceptedAt: string;
};

type AdminRequest = {
  TaskID: string;
  DisplayID: string;
  UserPhone: string;
  Category: string;
  Area: string;
  Details: string;
  Status: string;
  RawStatus: string;
  CreatedAt: string;
  NotifiedAt: string;
  AssignedProvider: string;
  AssignedProviderName: string;
  ProviderResponseAt: string;
  RespondedProvider: string;
  RespondedProviderName: string;
  LastReminderAt: string;
  CompletedAt: string;
  SelectedTimeframe: string;
  Priority: string;
  Deadline: string;
  IsOverdue: boolean;
  IsExpired: boolean;
  NeedsAttention: boolean;
  AttentionThresholdMinutes: number;
  MinutesUntilDeadline: number;
  OverdueMinutes: number;
  ServiceDate: string;
  TimeSlot: string;
  WaitingMinutes: number;
  ResponseWaitingMinutes: number;
  MatchedProviders: string[];
  MatchedProviderDetails: MatchedProviderDetail[];
};

type AdminRequestMetrics = {
  urgentRequestsOpen: number;
  priorityRequestsOpen: number;
  overdueRequests: number;
  newRequestsToday: number;
  pendingProviderResponse: number;
  requestsCompletedToday: number;
  averageResponseTimeMinutes: number;
  needsAttentionCount: number;
};

export type AdminRequestsPayload =
  | {
      ok: true;
      status: "success";
      requests: AdminRequest[];
      metrics: AdminRequestMetrics;
    }
  | {
      ok: false;
      error: string;
    };

type TaskRow = {
  task_id: string;
  display_id: string | number | null;
  category: string | null;
  area: string | null;
  details: string | null;
  phone: string | null;
  status: string | null;
  created_at: string | null;
  selected_timeframe: string | null;
  service_date: string | null;
  time_slot: string | null;
  assigned_provider_id: string | null;
  closed_at: string | null;
};

type MatchRow = {
  task_id: string;
  provider_id: string;
  match_status: string | null;
  created_at: string | null;
};

type ProviderRow = {
  provider_id: string;
  full_name: string | null;
  phone: string | null;
  verified: string | null;
};

function parseTaskDateMs(value: unknown): number {
  if (!value && value !== 0) return 0;
  if (Object.prototype.toString.call(value) === "[object Date]") {
    const time = (value as Date).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return parsed;

  const match = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) return 0;

  const day = Number(match[1]) || 1;
  const month = (Number(match[2]) || 1) - 1;
  const year = Number(match[3]) || 1970;
  const hours = Number(match[4] || 0);
  const minutes = Number(match[5] || 0);
  const seconds = Number(match[6] || 0);

  return new Date(year, month, day, hours, minutes, seconds).getTime();
}

function toIsoDateString(value: unknown): string {
  const ms = parseTaskDateMs(value);
  return ms ? new Date(ms).toISOString() : "";
}

function minutesSince(value: unknown): number {
  const ms = parseTaskDateMs(value);
  if (!ms) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / 60000));
}

function normalizeSelectedTimeframe(
  value: unknown,
  serviceDateValue: unknown,
  createdAtValue: unknown
): string {
  const raw = String(value ?? "").trim();
  const normalized = raw.toLowerCase();

  if (normalized === "right now" || normalized === "within 2 hours" || normalized === "asap") {
    return "Within 2 hours";
  }
  if (normalized === "within 6 hours" || normalized === "6 hours") {
    return "Within 6 hours";
  }
  if (normalized === "today" || normalized === "same day") {
    return "Today";
  }
  if (normalized === "tomorrow") {
    return "Tomorrow";
  }
  if (
    normalized === "schedule later" ||
    normalized === "within 1-2 days" ||
    normalized === "1-2 days" ||
    normalized === "flexible"
  ) {
    return raw || "Schedule later";
  }

  const createdAtMs = parseTaskDateMs(createdAtValue);
  const serviceDateMs = parseTaskDateMs(serviceDateValue);
  if (serviceDateMs && createdAtMs) {
    const createdDate = new Date(createdAtMs);
    const serviceDate = new Date(serviceDateMs);
    const dayDiff = Math.floor(
      (new Date(
        serviceDate.getFullYear(),
        serviceDate.getMonth(),
        serviceDate.getDate()
      ).getTime() -
        new Date(
          createdDate.getFullYear(),
          createdDate.getMonth(),
          createdDate.getDate()
        ).getTime()) /
        86400000
    );

    if (dayDiff <= 0) return "Today";
    if (dayDiff === 1) return "Tomorrow";
    return "Schedule later";
  }

  if (serviceDateMs) return "Schedule later";
  return raw || "Today";
}

function getTimeSlotStartHour(timeSlotValue: unknown): number {
  const normalized = String(timeSlotValue ?? "").trim().toLowerCase();
  if (normalized === "morning") return 8;
  if (normalized === "noon") return 11;
  if (normalized === "afternoon") return 14;
  if (normalized === "evening") return 17;
  return 9;
}

function buildLocalDateMs(dateValue: unknown, hour: number, minute: number): number {
  const raw = String(dateValue ?? "").trim();
  if (!raw) return 0;

  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(
      Number(isoMatch[1]),
      Number(isoMatch[2]) - 1,
      Number(isoMatch[3]),
      hour || 0,
      minute || 0,
      0,
      0
    ).getTime();
  }

  const baseMs = parseTaskDateMs(raw);
  if (!baseMs) return 0;
  const baseDate = new Date(baseMs);
  return new Date(
    baseDate.getFullYear(),
    baseDate.getMonth(),
    baseDate.getDate(),
    hour || 0,
    minute || 0,
    0,
    0
  ).getTime();
}

function endOfDayMs(baseMs: number): number {
  if (!baseMs) return 0;
  const date = new Date(baseMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999).getTime();
}

function getFlexibleDeadlineMs(
  createdAtMs: number,
  serviceDateValue: unknown,
  timeSlotValue: unknown
): number {
  const slotStartHour = getTimeSlotStartHour(timeSlotValue);
  const scheduledMs = buildLocalDateMs(serviceDateValue, slotStartHour, 0);
  if (scheduledMs) return scheduledMs;

  const serviceDateMs = parseTaskDateMs(serviceDateValue);
  if (serviceDateMs) return endOfDayMs(serviceDateMs);

  return createdAtMs ? createdAtMs + 48 * 60000 * 60 : 0;
}

function getPriorityAttentionThresholdMinutes(priority: string): number {
  if (priority === "URGENT") return 10;
  if (priority === "PRIORITY") return 30;
  if (priority === "SAME_DAY") return 60;
  return 180;
}

function deriveAdminRequestTiming(
  selectedTimeframeValue: unknown,
  createdAtValue: unknown,
  serviceDateValue: unknown,
  timeSlotValue: unknown
) {
  const createdAtMs = parseTaskDateMs(createdAtValue);
  const selectedTimeframe = normalizeSelectedTimeframe(
    selectedTimeframeValue,
    serviceDateValue,
    createdAtValue
  );
  const normalized = String(selectedTimeframe || "").trim().toLowerCase();
  let priority = "FLEXIBLE";
  let deadlineMs = 0;

  if (normalized === "within 2 hours" || normalized === "right now" || normalized === "asap") {
    priority = "URGENT";
    deadlineMs = createdAtMs ? createdAtMs + 120 * 60000 : 0;
  } else if (normalized === "within 6 hours" || normalized === "6 hours") {
    priority = "PRIORITY";
    deadlineMs = createdAtMs ? createdAtMs + 360 * 60000 : 0;
  } else if (normalized === "today" || normalized === "same day") {
    priority = "SAME_DAY";
    deadlineMs = endOfDayMs(createdAtMs);
  } else if (normalized === "tomorrow") {
    priority = "FLEXIBLE";
    deadlineMs =
      buildLocalDateMs(serviceDateValue, getTimeSlotStartHour(timeSlotValue), 0) ||
      (createdAtMs ? endOfDayMs(createdAtMs + 24 * 60000 * 60) : 0);
  } else {
    priority = "FLEXIBLE";
    deadlineMs = getFlexibleDeadlineMs(createdAtMs, serviceDateValue, timeSlotValue);
  }

  const waitingMinutes = createdAtMs ? Math.max(0, Math.floor((Date.now() - createdAtMs) / 60000)) : 0;
  const minutesUntilDeadline = deadlineMs ? Math.floor((deadlineMs - Date.now()) / 60000) : 0;

  return {
    SelectedTimeframe: selectedTimeframe,
    Priority: priority,
    Deadline: deadlineMs ? new Date(deadlineMs).toISOString() : "",
    WaitingMinutes: waitingMinutes,
    MinutesUntilDeadline: minutesUntilDeadline,
    OverdueMinutes: minutesUntilDeadline < 0 ? Math.abs(minutesUntilDeadline) : 0,
    AttentionThresholdMinutes: getPriorityAttentionThresholdMinutes(priority),
  };
}

function normalizeAdminRequestStatus(
  statusValue: unknown,
  assignedProvider: string,
  providerResponseAt: string,
  completedAt: string
): string {
  if (completedAt) return "COMPLETED";

  const normalizedStatus = String(statusValue ?? "").trim().toLowerCase();
  if (normalizedStatus === "completed" || normalizedStatus === "closed") return "COMPLETED";
  if (normalizedStatus === "assigned" || assignedProvider) return "ASSIGNED";
  if (normalizedStatus === "responded" || normalizedStatus === "provider_responded" || providerResponseAt) {
    return "RESPONDED";
  }
  if (normalizedStatus === "notified") return "NOTIFIED";
  if (
    normalizedStatus === "submitted" ||
    normalizedStatus === "new" ||
    normalizedStatus === "no_providers_matched" ||
    !normalizedStatus
  ) {
    return "NEW";
  }

  return normalizedStatus.toUpperCase();
}

function getAdminRequestMetrics(requests: AdminRequest[]): AdminRequestMetrics {
  const today = new Date();
  const isSameDay = (value: string) => {
    const ms = parseTaskDateMs(value);
    if (!ms) return false;
    const date = new Date(ms);
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };

  const respondedDurations = requests
    .filter((request) => request.ProviderResponseAt)
    .map((request) => {
      const createdMs = parseTaskDateMs(request.CreatedAt);
      const respondedMs = parseTaskDateMs(request.ProviderResponseAt);
      return createdMs && respondedMs && respondedMs >= createdMs
        ? Math.floor((respondedMs - createdMs) / 60000)
        : 0;
    })
    .filter((value) => value > 0);

  const averageResponseTimeMinutes = respondedDurations.length
    ? Math.round(respondedDurations.reduce((sum, value) => sum + value, 0) / respondedDurations.length)
    : 0;

  return {
    urgentRequestsOpen: requests.filter(
      (request) => request.Priority === "URGENT" && request.Status !== "COMPLETED"
    ).length,
    priorityRequestsOpen: requests.filter(
      (request) => request.Priority === "PRIORITY" && request.Status !== "COMPLETED"
    ).length,
    overdueRequests: requests.filter(
      (request) => request.IsOverdue && request.Status !== "COMPLETED"
    ).length,
    newRequestsToday: requests.filter(
      (request) => request.Status === "NEW" && isSameDay(request.CreatedAt)
    ).length,
    pendingProviderResponse: requests.filter(
      (request) => request.Status === "NOTIFIED" && !request.AssignedProvider
    ).length,
    requestsCompletedToday: requests.filter(
      (request) => request.Status === "COMPLETED" && isSameDay(request.CompletedAt)
    ).length,
    averageResponseTimeMinutes,
    needsAttentionCount: requests.filter(
      (request) => request.NeedsAttention && request.Status !== "COMPLETED"
    ).length,
  };
}

export async function getAdminRequestsFromSupabase(): Promise<AdminRequestsPayload> {
  try {
    const { data: tasks, error: tasksError } = await adminSupabase
      .from("tasks")
      .select(
        "task_id, display_id, category, area, details, phone, status, created_at, selected_timeframe, service_date, time_slot, assigned_provider_id, closed_at"
      )
      .order("created_at", { ascending: false });

    if (tasksError) return { ok: false, error: tasksError.message };

    const taskRows = (tasks ?? []) as TaskRow[];
    if (taskRows.length === 0) {
      return {
        ok: true,
        status: "success",
        requests: [],
        metrics: getAdminRequestMetrics([]),
      };
    }

    const taskIds = taskRows.map((task) => String(task.task_id || "").trim()).filter(Boolean);
    const { data: matchesData, error: matchesError } = await adminSupabase
      .from("provider_task_matches")
      .select("task_id, provider_id, match_status, created_at")
      .in("task_id", taskIds);

    if (matchesError) return { ok: false, error: matchesError.message };

    const matchRows = (matchesData ?? []) as MatchRow[];
    const providerIds = new Set<string>();
    for (const task of taskRows) {
      if (task.assigned_provider_id) {
        providerIds.add(String(task.assigned_provider_id).trim());
      }
    }
    for (const match of matchRows) {
      if (match.provider_id) {
        providerIds.add(String(match.provider_id).trim());
      }
    }

    const providerById = new Map<string, ProviderRow>();
    if (providerIds.size > 0) {
      const { data: providersData, error: providersError } = await adminSupabase
        .from("providers")
        .select("provider_id, full_name, phone, verified")
        .in("provider_id", [...providerIds]);

      if (providersError) return { ok: false, error: providersError.message };

      for (const provider of (providersData ?? []) as ProviderRow[]) {
        providerById.set(String(provider.provider_id || "").trim(), provider);
      }
    }

    const matchesByTask = new Map<string, MatchRow[]>();
    for (const row of matchRows) {
      const taskId = String(row.task_id || "").trim();
      if (!taskId) continue;
      const existing = matchesByTask.get(taskId) ?? [];
      existing.push(row);
      matchesByTask.set(taskId, existing);
    }

    const requests: AdminRequest[] = taskRows.map((task) => {
      const taskId = String(task.task_id || "").trim();
      const taskMatches = (matchesByTask.get(taskId) ?? []).slice().sort((a, b) => {
        return parseTaskDateMs(a.created_at) - parseTaskDateMs(b.created_at);
      });

      const earliestMatch = taskMatches.find((match) => parseTaskDateMs(match.created_at) > 0);
      const respondedMatch =
        taskMatches.find((match) => {
          const status = String(match.match_status || "").trim().toLowerCase();
          return status === "responded" || status === "accepted";
        }) ?? null;

      const matchedProviders: string[] = [];
      const matchedProviderDetails: MatchedProviderDetail[] = [];
      for (const match of taskMatches) {
        const providerId = String(match.provider_id || "").trim();
        if (!providerId || matchedProviders.includes(providerId)) continue;
        matchedProviders.push(providerId);

        const provider = providerById.get(providerId);
        const matchStatus = String(match.match_status || "").trim().toLowerCase();
        const acceptedAt = matchStatus === "responded" || matchStatus === "accepted"
          ? toIsoDateString(match.created_at)
          : "";

        matchedProviderDetails.push({
          ProviderID: providerId,
          ProviderName: String(provider?.full_name || "").trim(),
          ProviderPhone: String(provider?.phone || "").trim(),
          Verified: String(provider?.verified || "no").trim() || "no",
          OtpVerified: "no",
          OtpVerifiedAt: "",
          PendingApproval: "",
          ResponseStatus: matchStatus || (acceptedAt ? "accepted" : "new"),
          CreatedAt: toIsoDateString(match.created_at),
          AcceptedAt: acceptedAt,
        });
      }

      const assignedProvider = String(task.assigned_provider_id || "").trim();
      const assignedProviderRow = assignedProvider ? providerById.get(assignedProvider) : undefined;
      const respondedProviderId = respondedMatch ? String(respondedMatch.provider_id || "").trim() : "";
      const respondedProviderRow = respondedProviderId ? providerById.get(respondedProviderId) : undefined;
      const notifiedAt = earliestMatch ? toIsoDateString(earliestMatch.created_at) : "";
      const providerResponseAt = respondedMatch ? toIsoDateString(respondedMatch.created_at) : "";
      const completedAt = toIsoDateString(task.closed_at);

      const timing = deriveAdminRequestTiming(
        task.selected_timeframe,
        task.created_at,
        task.service_date,
        task.time_slot
      );
      const createdAtIso = toIsoDateString(task.created_at);
      const status = normalizeAdminRequestStatus(
        task.status,
        assignedProvider,
        providerResponseAt,
        completedAt
      );
      const waitingMinutes = timing.WaitingMinutes || minutesSince(task.created_at);
      const responseWaitingMinutes = minutesSince(notifiedAt || task.created_at);
      const isResolved = status === "COMPLETED";
      const isOverdue = Boolean(timing.Deadline && timing.MinutesUntilDeadline < 0 && !isResolved);
      const needsAttention = Boolean(
        !isResolved && (isOverdue || waitingMinutes >= timing.AttentionThresholdMinutes)
      );

      return {
        TaskID: taskId,
        DisplayID:
          task.display_id === null || task.display_id === undefined
            ? ""
            : String(task.display_id).trim(),
        UserPhone: String(task.phone || "").trim(),
        Category: String(task.category || "").trim(),
        Area: String(task.area || "").trim(),
        Details: String(task.details || "").trim(),
        Status: status,
        RawStatus: String(task.status || "").trim(),
        CreatedAt: createdAtIso,
        NotifiedAt: notifiedAt,
        AssignedProvider: assignedProvider,
        AssignedProviderName: String(assignedProviderRow?.full_name || "").trim(),
        ProviderResponseAt: providerResponseAt,
        RespondedProvider: respondedProviderId,
        RespondedProviderName: String(respondedProviderRow?.full_name || "").trim(),
        LastReminderAt: "",
        CompletedAt: completedAt,
        SelectedTimeframe: timing.SelectedTimeframe,
        Priority: timing.Priority,
        Deadline: timing.Deadline,
        IsOverdue: isOverdue,
        IsExpired: isOverdue,
        NeedsAttention: needsAttention,
        AttentionThresholdMinutes: timing.AttentionThresholdMinutes,
        MinutesUntilDeadline: timing.MinutesUntilDeadline,
        OverdueMinutes: timing.OverdueMinutes,
        ServiceDate: String(task.service_date || "").trim(),
        TimeSlot: String(task.time_slot || "").trim(),
        WaitingMinutes: waitingMinutes,
        ResponseWaitingMinutes: responseWaitingMinutes,
        MatchedProviders: matchedProviders,
        MatchedProviderDetails: matchedProviderDetails,
      };
    });

    requests.sort((a, b) => parseTaskDateMs(b.CreatedAt) - parseTaskDateMs(a.CreatedAt));

    return {
      ok: true,
      status: "success",
      requests,
      metrics: getAdminRequestMetrics(requests),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to load admin requests",
    };
  }
}
