import type { Page } from "@playwright/test";

import {
  COMMON_AREAS,
  COMMON_CATEGORIES,
  QA_AREA,
  QA_DISPLAY_ID,
  QA_NEED_ID,
  QA_PROVIDER_ID,
  QA_PROVIDER_MESSAGE,
  QA_PROVIDER_NAME,
  QA_PROVIDER_PHONE,
  QA_TASK_ID,
  QA_THREAD_ID,
  QA_USER_MESSAGE,
  QA_USER_PHONE,
  buildAdminDashboardPayload,
  buildAdminRequestsPayload,
  buildAreaMappingsPayload,
  buildChatMessage,
  buildChatThread,
  buildIssueReportsPayload,
  buildNeed,
  buildNeedMessage,
  buildNeedThread,
  buildNotificationLogsPayload,
  buildProviderDashboardResponse,
  buildUnmappedAreasPayload,
  buildUserRequest,
} from "./data";
import {
  jsonError,
  jsonOk,
  mockJson,
  mockKkActions,
} from "./routes";

type JsonRecord = Record<string, unknown>;
type NotificationSummary = {
  total: number;
  accepted: number;
  failed: number;
  error: number;
};

type UserRequestsScenarioOptions = {
  requests?: JsonRecord[];
  globalThreads?: JsonRecord[];
  taskThreads?: JsonRecord[];
  thread?: JsonRecord;
  messages?: JsonRecord[];
  chatAccessDenied?: boolean;
};

type NeedScenarioOptions = {
  needs?: JsonRecord[];
  responseThreads?: JsonRecord[];
  conversationThread?: JsonRecord;
  messages?: JsonRecord[];
};

type ProviderDashboardScenarioOptions = {
  dashboardResponse?: JsonRecord;
  thread?: JsonRecord;
  messages?: JsonRecord[];
};

type ProviderRegistrationScenarioOptions = {
  dashboardResponse?: JsonRecord;
  registerResponse?: JsonRecord;
};

type AdminDashboardScenarioOptions = {
  dashboardResponse?: JsonRecord;
  requestsResponse?: JsonRecord;
  areaMappingsResponse?: JsonRecord;
  unmappedAreasResponse?: JsonRecord;
  issueReportsResponse?: JsonRecord;
  notificationLogsResponse?: JsonRecord;
  chatThreads?: JsonRecord[];
  chatMessages?: JsonRecord[];
};

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asRecord(value: unknown, fallback: JsonRecord = {}): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : fallback;
}

function asRecordArray(value: unknown, fallback: JsonRecord[] = []): JsonRecord[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is JsonRecord => Boolean(item) && typeof item === "object")
        .map((item) => asRecord(item))
    : fallback;
}

function nextIso(offsetMs = 0): string {
  return new Date(Date.now() + offsetMs).toISOString();
}

function buildCreateThreadPayload(thread: JsonRecord): JsonRecord {
  return {
    ThreadID: asString(thread.ThreadID, QA_THREAD_ID),
    created: false,
    thread,
  };
}

function buildProviderLookup(provider: JsonRecord): JsonRecord {
  return {
    ProviderID: asString(provider.ProviderID, QA_PROVIDER_ID),
    Name: asString(provider.ProviderName || provider.Name, QA_PROVIDER_NAME),
    Phone: asString(provider.Phone, QA_PROVIDER_PHONE),
    Verified: asString(provider.Verified, "yes"),
    PendingApproval: asString(provider.PendingApproval, "no"),
    Status: asString(provider.Status, "active"),
  };
}

function buildNotificationSummaryFromLogs(logs: JsonRecord[]): NotificationSummary {
  return logs.reduce<NotificationSummary>(
    (summary, log) => {
      const normalizedStatus = asString(log.Status).trim().toLowerCase();
      summary.total += 1;
      if (normalizedStatus === "accepted") summary.accepted += 1;
      if (normalizedStatus === "failed") summary.failed += 1;
      if (normalizedStatus === "error") summary.error += 1;
      return summary;
    },
    { total: 0, accepted: 0, failed: 0, error: 0 }
  );
}

export async function mockReportIssueApi(page: Page, issueId = "ISSUE-QA-NEW"): Promise<void> {
  await mockJson(page, "**/api/provider/dashboard-profile**", jsonOk({ provider: null }));
  await mockKkActions(page, {
    get_provider_by_phone: () => jsonOk({ provider: null }),
    get_my_needs: () => jsonOk({ needs: [] }),
  });
  await mockJson(page, "**/api/report-issue**", jsonOk({ issueId }));
}

export async function mockUserRequestsApis(
  page: Page,
  {
    requests = [deepClone(buildUserRequest())],
    globalThreads,
    taskThreads,
    thread = deepClone(buildChatThread()),
    messages = [deepClone(buildChatMessage())],
    chatAccessDenied = false,
  }: UserRequestsScenarioOptions = {}
): Promise<void> {
  const currentThread = deepClone(asRecord(thread));
  const currentMessages = deepClone(asRecordArray(messages));
  const listThreads = deepClone(globalThreads ?? [currentThread]);
  const scopedThreads = deepClone(taskThreads ?? [currentThread]);

  await mockJson(page, "**/api/provider/dashboard-profile**", jsonOk({ provider: null }));
  await mockJson(page, "**/api/my-requests**", jsonOk({ requests }));

  await mockKkActions(page, {
    get_provider_by_phone: () => jsonOk({ provider: null }),
    get_my_needs: () => jsonOk({ needs: [] }),
    chat_get_threads: ({ body }) => {
      const taskId = asString(body.TaskID).trim();
      if (taskId) {
        return jsonOk({ threads: scopedThreads });
      }
      return jsonOk({ threads: listThreads });
    },
    chat_create_or_get_thread: () => jsonOk(buildCreateThreadPayload(currentThread)),
    chat_get_messages: () => {
      if (chatAccessDenied) {
        return jsonError("Access denied", 403);
      }
      return jsonOk({ thread: currentThread, messages: currentMessages });
    },
    chat_mark_read: ({ body }) => {
      const actorType = asString(body.ActorType).trim().toLowerCase();
      if (actorType === "provider") {
        currentThread.UnreadProviderCount = 0;
      } else {
        currentThread.UnreadUserCount = 0;
      }
      return jsonOk({ markedCount: 1, thread: currentThread });
    },
    chat_send_message: ({ body }) => {
      const actorType = asString(body.ActorType).trim().toLowerCase() || "user";
      const messageText = asString(body.MessageText, QA_USER_MESSAGE).trim() || QA_USER_MESSAGE;
      const nextMessage = buildChatMessage({
        MessageID: `MSG-QA-${String(currentMessages.length + 1).padStart(4, "0")}`,
        SenderType: actorType,
        MessageText: messageText,
        CreatedAt: nextIso(currentMessages.length * 1000 + 1000),
      });
      currentMessages.push(nextMessage);
      currentThread.LastMessageAt = asString(nextMessage.CreatedAt, nextIso());
      currentThread.LastMessageBy = actorType;
      currentThread.UnreadUserCount = actorType === "provider" ? 1 : 0;
      currentThread.UnreadProviderCount = actorType === "user" ? 1 : 0;
      return jsonOk({ message: nextMessage, thread: currentThread });
    },
  });
}

export async function mockNeedApis(
  page: Page,
  {
    needs = [deepClone(buildNeed())],
    responseThreads = [deepClone(buildNeedThread())],
    conversationThread = deepClone(buildNeedThread()),
    messages = [deepClone(buildNeedMessage())],
  }: NeedScenarioOptions = {}
): Promise<void> {
  const currentNeeds = deepClone(asRecordArray(needs));
  const currentResponseThreads = deepClone(asRecordArray(responseThreads));
  const currentThread = deepClone(asRecord(conversationThread));
  const currentMessages = deepClone(asRecordArray(messages));

  await mockJson(page, "**/api/provider/dashboard-profile**", jsonOk({ provider: null }));
  await mockKkActions(page, {
    get_provider_by_phone: () => jsonOk({ provider: null }),
    get_my_needs: () => jsonOk({ needs: currentNeeds }),
    mark_need_complete: ({ body }) => {
      const needId = asString(body.NeedID);
      for (const need of currentNeeds) {
        if (asString(need.NeedID) === needId) {
          need.CurrentStatus = "completed";
        }
      }
      return jsonOk({ NeedID: needId });
    },
    close_need: ({ body }) => {
      const needId = asString(body.NeedID);
      for (const need of currentNeeds) {
        if (asString(need.NeedID) === needId) {
          need.CurrentStatus = "closed";
        }
      }
      return jsonOk({ NeedID: needId });
    },
    create_need: ({ body }) => {
      const nextNeed = buildNeed({
        NeedID: `ND-QA-${String(currentNeeds.length + 1).padStart(4, "0")}`,
        Category: asString(body.Category, "Employee"),
        Area: asString(body.Area, QA_AREA),
        Title: asString(body.Title, "New need"),
        Description: asString(body.Description, "Generated need"),
        CurrentStatus: "open",
      });
      currentNeeds.unshift(nextNeed);
      return jsonOk({
        NeedID: asString(nextNeed.NeedID, QA_NEED_ID),
        needId: asString(nextNeed.NeedID, QA_NEED_ID),
      });
    },
    need_chat_get_threads_for_need: () => jsonOk({ threads: currentResponseThreads }),
    need_chat_get_messages: () => jsonOk({ thread: currentThread, messages: currentMessages }),
    need_chat_mark_read: () => {
      currentThread.UnreadPosterCount = 0;
      currentThread.UnreadResponderCount = 0;
      return jsonOk({ markedCount: 1, thread: currentThread });
    },
    need_chat_send_message: ({ body }) => {
      const actorRole = asString(body.ActorRole, "poster");
      const messageText = asString(body.MessageText, QA_USER_MESSAGE).trim() || QA_USER_MESSAGE;
      const nextMessage = buildNeedMessage({
        MessageID: `NEED-MSG-${String(currentMessages.length + 1).padStart(4, "0")}`,
        SenderRole: actorRole,
        MessageText: messageText,
        CreatedAt: "22/04/2026 12:35:00",
      });
      currentMessages.push(nextMessage);
      currentThread.LastMessageAt = asString(nextMessage.CreatedAt, "22/04/2026 12:35:00");
      currentThread.LastMessageBy = actorRole;
      currentThread.UnreadPosterCount = actorRole === "responder" ? 1 : 0;
      currentThread.UnreadResponderCount = actorRole === "poster" ? 1 : 0;
      return jsonOk({ message: nextMessage, thread: currentThread });
    },
  });
}

export async function mockProviderDashboardApis(
  page: Page,
  {
    dashboardResponse = deepClone(buildProviderDashboardResponse()),
    thread = deepClone(buildChatThread()),
    messages = [deepClone(buildChatMessage())],
  }: ProviderDashboardScenarioOptions = {}
): Promise<void> {
  const dashboard = deepClone(asRecord(dashboardResponse));
  const provider = asRecord(dashboard.provider);
  const currentThread = deepClone(asRecord(thread));
  const currentMessages = deepClone(asRecordArray(messages));

  await mockJson(page, "**/api/provider/dashboard-profile**", {
    status: 200,
    body: dashboard,
  });

  await mockKkActions(page, {
    get_provider_by_phone: () => jsonOk({ provider: buildProviderLookup(provider) }),
    get_my_needs: () => jsonOk({ needs: [] }),
    chat_get_threads: () => jsonOk({ threads: [currentThread] }),
    chat_create_or_get_thread: () => jsonOk(buildCreateThreadPayload(currentThread)),
    chat_get_messages: () => jsonOk({ thread: currentThread, messages: currentMessages }),
    chat_mark_read: ({ body }) => {
      const actorType = asString(body.ActorType).trim().toLowerCase();
      if (actorType === "provider") {
        currentThread.UnreadProviderCount = 0;
      } else {
        currentThread.UnreadUserCount = 0;
      }
      return jsonOk({ markedCount: 1, thread: currentThread });
    },
    chat_send_message: ({ body }) => {
      const actorType = asString(body.ActorType).trim().toLowerCase() || "provider";
      const messageText =
        asString(body.MessageText, QA_PROVIDER_MESSAGE).trim() || QA_PROVIDER_MESSAGE;
      const nextMessage = buildChatMessage({
        MessageID: `MSG-PROVIDER-${String(currentMessages.length + 1).padStart(4, "0")}`,
        SenderType: actorType,
        MessageText: messageText,
        CreatedAt: nextIso(currentMessages.length * 1000 + 1000),
      });
      currentMessages.push(nextMessage);
      currentThread.LastMessageAt = asString(nextMessage.CreatedAt, nextIso());
      currentThread.LastMessageBy = actorType;
      currentThread.UnreadUserCount = actorType === "provider" ? 1 : 0;
      currentThread.UnreadProviderCount = actorType === "user" ? 1 : 0;
      return jsonOk({ message: nextMessage, thread: currentThread });
    },
  });
}

export async function mockProviderRegistrationApis(
  page: Page,
  {
    dashboardResponse = deepClone(buildProviderDashboardResponse()),
    registerResponse,
  }: ProviderRegistrationScenarioOptions = {}
): Promise<void> {
  const dashboard = deepClone(asRecord(dashboardResponse));
  const provider = asRecord(dashboard.provider);
  const resolvedRegisterResponse =
    registerResponse ??
    ({
      providerId: asString(provider.ProviderID, QA_PROVIDER_ID),
      message: "Registration successful.",
      verified: asString(provider.Verified, "yes"),
      pendingApproval: asString(provider.PendingApproval, "no"),
      requestedNewCategories: [],
      requestedNewAreas: [],
    } as JsonRecord);

  await mockJson(
    page,
    "**/api/categories**",
    jsonOk({
      data: COMMON_CATEGORIES.map((category) => ({
        name: category.name,
        active: category.active,
      })),
    })
  );
  await mockJson(page, "**/api/provider/dashboard-profile**", {
    status: 200,
    body: dashboard,
  });

  await mockKkActions(page, {
    request_new_category: () => jsonOk({ requestId: "CAT-REQUEST-QA-NEW" }),
    get_areas: () => jsonOk({ areas: COMMON_AREAS }),
    get_provider_by_phone: () => jsonOk({ provider: buildProviderLookup(provider) }),
    get_my_needs: () => jsonOk({ needs: [] }),
    provider_register: ({ body }) => {
      provider.ProviderID = asString(provider.ProviderID, QA_PROVIDER_ID);
      provider.ProviderName = asString(body.name, QA_PROVIDER_NAME);
      provider.Phone = asString(body.phone, QA_PROVIDER_PHONE);
      provider.Verified = asString(
        resolvedRegisterResponse.verified,
        asString(provider.Verified, "yes")
      );
      provider.PendingApproval = asString(
        resolvedRegisterResponse.pendingApproval,
        asString(provider.PendingApproval, "no")
      );
      return jsonOk(resolvedRegisterResponse);
    },
  });
}

export async function mockAdminDashboardApis(
  page: Page,
  {
    dashboardResponse = deepClone(buildAdminDashboardPayload()),
    requestsResponse = deepClone(buildAdminRequestsPayload()),
    areaMappingsResponse = deepClone(buildAreaMappingsPayload()),
    unmappedAreasResponse = deepClone(buildUnmappedAreasPayload()),
    issueReportsResponse = deepClone(buildIssueReportsPayload()),
    notificationLogsResponse = deepClone(buildNotificationLogsPayload()),
    chatThreads = [
      {
        ThreadID: QA_THREAD_ID,
        TaskID: QA_TASK_ID,
        DisplayID: QA_DISPLAY_ID,
        UserPhoneMasked: `xxxxxx${QA_USER_PHONE.slice(-4)}`,
        ProviderID: QA_PROVIDER_ID,
        ProviderName: QA_PROVIDER_NAME,
        LastMessagePreview: QA_PROVIDER_MESSAGE,
        LastMessageAt: "2026-04-22T10:31:00.000Z",
        ThreadStatus: "active",
        ModerationReason: "",
      },
    ],
    chatMessages = [
      {
        MessageID: "ADMIN-CHAT-MSG-0001",
        SenderType: "provider",
        MessageText: QA_PROVIDER_MESSAGE,
        CreatedAt: "2026-04-22T10:31:00.000Z",
      },
    ],
  }: AdminDashboardScenarioOptions = {}
): Promise<void> {
  const dashboard = deepClone(asRecord(dashboardResponse));
  const providers = deepClone(asRecordArray(dashboard.providers));
  const categoryApplications = deepClone(asRecordArray(dashboard.categoryApplications));
  const categories = deepClone(asRecordArray(dashboard.categories));
  const areas = deepClone(asRecordArray(dashboard.areas));
  const adminRequests = deepClone(asRecordArray(asRecord(requestsResponse).requests));
  const requestMetrics = asRecord(asRecord(requestsResponse).metrics);
  const areaMappings = deepClone(asRecordArray(asRecord(areaMappingsResponse).mappings));
  const unmappedReviews = deepClone(asRecordArray(asRecord(unmappedAreasResponse).reviews));
  const issueReports = deepClone(asRecordArray(asRecord(issueReportsResponse).reports));
  const notificationLogs = deepClone(asRecordArray(asRecord(notificationLogsResponse).logs));
  const monitoredChatThreads = deepClone(asRecordArray(chatThreads));
  const monitoredChatMessages = deepClone(asRecordArray(chatMessages));

  const buildAdminStatsPayload = (): JsonRecord => ({
    ok: true,
    stats: {
      totalProviders: providers.length,
      verifiedProviders: providers.filter(
        (provider) => asString(provider.Verified).trim().toLowerCase() === "yes"
      ).length,
      pendingAdminApprovals: providers.filter(
        (provider) => asString(provider.PendingApproval).trim().toLowerCase() === "yes"
      ).length,
      pendingCategoryRequests: categoryApplications.filter(
        (item) => asString(item.Status, "pending").trim().toLowerCase() === "pending"
      ).length,
    },
    providers,
    categoryApplications,
    categories,
    areas,
  });

  const findProvider = (providerId: string): JsonRecord | undefined =>
    providers.find((provider) => asString(provider.ProviderID) === providerId);

  const findAreaMapping = (canonicalArea: string): JsonRecord | undefined =>
    areaMappings.find((mapping) => asString(mapping.CanonicalArea) === canonicalArea);

  await mockJson(page, "**/api/provider/dashboard-profile**", jsonOk({ provider: null }));
  await mockJson(page, "**/api/admin/stats**", () => ({
    status: 200,
    body: buildAdminStatsPayload(),
  }));

  await mockKkActions(page, {
    get_provider_by_phone: () => jsonOk({ provider: null }),
    get_my_needs: () => jsonOk({ needs: [] }),
    get_admin_requests: () => jsonOk({ requests: adminRequests, metrics: requestMetrics }),
    get_admin_area_mappings: () => jsonOk({ mappings: areaMappings }),
    admin_get_unmapped_areas: () => jsonOk({ reviews: unmappedReviews }),
    admin_get_issue_reports: () => jsonOk({ reports: issueReports }),
    admin_notification_logs: () => jsonOk({ logs: notificationLogs }),
    admin_notification_summary: () =>
      jsonOk({ summary: buildNotificationSummaryFromLogs(notificationLogs) }),
    admin_list_chat_threads: () => jsonOk({ threads: monitoredChatThreads }),
    admin_get_chat_thread: ({ body }) => {
      const threadId = asString(body.ThreadID);
      const selectedThread =
        monitoredChatThreads.find((thread) => asString(thread.ThreadID) === threadId) || null;
      if (!selectedThread) {
        return jsonError("Chat thread not found", 404);
      }
      return jsonOk({ thread: selectedThread, messages: monitoredChatMessages });
    },
    admin_update_chat_thread_status: ({ body }) => {
      const threadId = asString(body.ThreadID);
      const nextStatus = asString(body.ThreadStatus, "active");
      const reason = asString(body.Reason, "");
      const selectedThread = monitoredChatThreads.find(
        (thread) => asString(thread.ThreadID) === threadId
      );
      if (!selectedThread) {
        return jsonError("Chat thread not found", 404);
      }
      selectedThread.ThreadStatus = nextStatus;
      selectedThread.ModerationReason = reason;
      return jsonOk({ thread: selectedThread, messages: monitoredChatMessages });
    },
    set_provider_verified: ({ body }) => {
      const providerId = asString(body.ProviderID || body.providerId);
      const verified = asString(body.verified, "yes");
      const provider = findProvider(providerId);
      if (!provider) {
        return jsonError("Provider not found", 404);
      }
      provider.Verified = verified;
      provider.PendingApproval = "no";
      provider.Status = verified === "yes" ? "active" : "pending";
      return jsonOk({ provider });
    },
    approve_category_request: ({ body }) => {
      const requestId = asString(body.RequestID || body.requestId);
      const nextIndex = categoryApplications.findIndex(
        (item) => asString(item.RequestID) === requestId
      );
      if (nextIndex >= 0) {
        categoryApplications.splice(nextIndex, 1);
      }
      return jsonOk({ requestId });
    },
    reject_category_request: ({ body }) => {
      const requestId = asString(body.RequestID || body.requestId);
      const nextIndex = categoryApplications.findIndex(
        (item) => asString(item.RequestID) === requestId
      );
      if (nextIndex >= 0) {
        categoryApplications.splice(nextIndex, 1);
      }
      return jsonOk({ requestId });
    },
    admin_close_category_request: ({ body }) => {
      const requestId = asString(body.RequestID || body.requestId);
      for (const request of categoryApplications) {
        if (asString(request.RequestID) === requestId) {
          request.Status = "closed";
        }
      }
      return jsonOk({ requestId });
    },
    admin_archive_category_request: ({ body }) => {
      const requestId = asString(body.RequestID || body.requestId);
      for (const request of categoryApplications) {
        if (asString(request.RequestID) === requestId) {
          request.Status = "archived";
        }
      }
      return jsonOk({ requestId });
    },
    admin_delete_category_request_soft: ({ body }) => {
      const requestId = asString(body.RequestID || body.requestId);
      const nextIndex = categoryApplications.findIndex(
        (item) => asString(item.RequestID) === requestId
      );
      if (nextIndex >= 0) {
        categoryApplications.splice(nextIndex, 1);
      }
      return jsonOk({ requestId });
    },
    add_area: ({ body }) => {
      const areaName = asString(body.areaName).trim();
      if (!areaName) {
        return jsonError("Area required", 400);
      }
      areaMappings.push({
        CanonicalArea: areaName,
        Active: "yes",
        Aliases: [],
        AliasCount: 0,
      });
      return jsonOk({ areaName });
    },
    edit_area: ({ body }) => {
      const oldArea = asString(body.oldArea).trim();
      const newArea = asString(body.newArea).trim();
      const mapping = findAreaMapping(oldArea);
      if (!mapping || !newArea) {
        return jsonError("Area not found", 404);
      }
      mapping.CanonicalArea = newArea;
      return jsonOk({ oldArea, newArea });
    },
    admin_add_area_alias: ({ body }) => {
      const canonicalArea = asString(body.canonicalArea).trim();
      const aliasName = asString(body.aliasName).trim();
      const mapping = findAreaMapping(canonicalArea);
      if (!mapping || !aliasName) {
        return jsonError("Alias add failed", 400);
      }
      const aliases = asRecordArray(mapping.Aliases);
      aliases.push({ AliasName: aliasName, Active: "yes" });
      mapping.Aliases = aliases;
      mapping.AliasCount = aliases.length;
      return jsonOk({ canonicalArea, aliasName });
    },
    admin_update_area_alias: ({ body }) => {
      const oldAliasName = asString(body.oldAliasName).trim();
      const newAliasName = asString(body.newAliasName).trim();
      const canonicalArea = asString(body.canonicalArea).trim();
      const mapping = findAreaMapping(canonicalArea);
      if (!mapping || !oldAliasName || !newAliasName) {
        return jsonError("Alias update failed", 400);
      }
      const aliases = asRecordArray(mapping.Aliases);
      for (const alias of aliases) {
        if (asString(alias.AliasName) === oldAliasName) {
          alias.AliasName = newAliasName;
        }
      }
      mapping.Aliases = aliases;
      mapping.AliasCount = aliases.length;
      return jsonOk({ oldAliasName, newAliasName });
    },
    admin_toggle_area_alias: ({ body }) => {
      const aliasName = asString(body.aliasName).trim();
      const canonicalArea = asString(body.canonicalArea).trim();
      const nextActive = asString(body.active, "yes");
      const mapping = findAreaMapping(canonicalArea);
      if (!mapping || !aliasName) {
        return jsonError("Alias toggle failed", 400);
      }
      const aliases = asRecordArray(mapping.Aliases);
      for (const alias of aliases) {
        if (asString(alias.AliasName) === aliasName) {
          alias.Active = nextActive;
        }
      }
      mapping.Aliases = aliases;
      mapping.AliasCount = aliases.length;
      return jsonOk({ aliasName, active: nextActive });
    },
    merge_area_into_canonical: ({ body }) => {
      const canonicalArea = asString(body.canonicalArea).trim();
      const sourceArea = asString(body.sourceArea).trim();
      const mapping = findAreaMapping(canonicalArea);
      if (!mapping || !sourceArea) {
        return jsonError("Merge failed", 400);
      }
      const aliases = asRecordArray(mapping.Aliases);
      aliases.push({ AliasName: sourceArea, Active: "yes" });
      mapping.Aliases = aliases;
      mapping.AliasCount = aliases.length;
      return jsonOk({ canonicalArea, sourceArea });
    },
    admin_map_unmapped_area: ({ body }) => {
      const reviewId = asString(body.ReviewID || body.reviewId).trim();
      const canonicalArea = asString(body.canonicalArea || body.CanonicalArea).trim();
      const rawArea = asString(body.rawArea || body.RawArea).trim();
      const mapping = findAreaMapping(canonicalArea);
      if (!reviewId || !mapping || !rawArea) {
        return jsonError("Map failed", 400);
      }
      const aliases = asRecordArray(mapping.Aliases);
      aliases.push({ AliasName: rawArea, Active: "yes" });
      mapping.Aliases = aliases;
      mapping.AliasCount = aliases.length;
      const nextIndex = unmappedReviews.findIndex(
        (review) => asString(review.ReviewID) === reviewId
      );
      if (nextIndex >= 0) {
        unmappedReviews.splice(nextIndex, 1);
      }
      return jsonOk({ canonicalArea, rawArea });
    },
    admin_create_area_from_unmapped: ({ body }) => {
      const reviewId = asString(body.ReviewID).trim();
      const rawArea = asString(body.rawArea).trim();
      if (!reviewId || !rawArea) {
        return jsonError("Create area failed", 400);
      }
      areaMappings.push({
        CanonicalArea: rawArea,
        Active: "yes",
        Aliases: [],
        AliasCount: 0,
      });
      const nextIndex = unmappedReviews.findIndex(
        (review) => asString(review.ReviewID) === reviewId
      );
      if (nextIndex >= 0) {
        unmappedReviews.splice(nextIndex, 1);
      }
      return jsonOk({ rawArea });
    },
    admin_resolve_unmapped_area: ({ body }) => {
      const reviewId = asString(body.ReviewID).trim();
      const nextIndex = unmappedReviews.findIndex(
        (review) => asString(review.ReviewID) === reviewId
      );
      if (nextIndex >= 0) {
        unmappedReviews.splice(nextIndex, 1);
      }
      return jsonOk({ reviewId });
    },
    admin_update_issue_report_status: ({ body }) => {
      const issueId = asString(body.IssueID).trim();
      const nextStatus = asString(body.Status, "open").trim();
      for (const report of issueReports) {
        if (asString(report.IssueID) === issueId) {
          report.Status = nextStatus;
        }
      }
      return jsonOk({ issueId, status: nextStatus });
    },
  });
}
