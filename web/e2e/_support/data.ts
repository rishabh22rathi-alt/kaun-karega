export const QA_CATEGORY = "Electrician";
export const QA_SECONDARY_CATEGORY = "Plumber";
export const QA_AREA = "Sardarpura";
export const QA_SECONDARY_AREA = "Shastri Nagar";
export const QA_TASK_ID = "TK-QA-0001";
export const QA_DISPLAY_ID = "101";
export const QA_DISPLAY_LABEL = "Kaam No. 101";
export const QA_THREAD_ID = "THREAD-QA-0001";
export const QA_NEED_ID = "ND-0001";
export const QA_NEED_THREAD_ID = "NEED-THREAD-QA-0001";
export const QA_USER_PHONE = "9999999901";
export const QA_PROVIDER_PHONE = "9999999902";
export const QA_PROVIDER_ID = "PR-QA-0001";
export const QA_PROVIDER_NAME = "ZZ QA Provider";
export const QA_ADMIN_PHONE = "9999999904";
export const QA_ADMIN_NAME = "QA Admin";
export const QA_REQUEST_DETAILS = "ZZ QA request details for Playwright audit.";
export const QA_PROVIDER_MESSAGE = "ZZ QA provider message";
export const QA_USER_MESSAGE = "ZZ QA user reply";

export const COMMON_CATEGORIES = [
  { name: QA_CATEGORY, active: "yes" },
  { name: QA_SECONDARY_CATEGORY, active: "yes" },
  { name: "Carpenter", active: "yes" },
];

export const COMMON_AREAS = [
  QA_AREA,
  QA_SECONDARY_AREA,
  "Ratanada",
  "Pal Road",
];

export function buildMatchedProvider(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ProviderID: QA_PROVIDER_ID,
    ProviderName: QA_PROVIDER_NAME,
    ProviderPhone: QA_PROVIDER_PHONE,
    Verified: "yes",
    OtpVerified: "yes",
    ResponseStatus: "responded",
    ...overrides,
  };
}

export function buildUserRequest(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    TaskID: QA_TASK_ID,
    DisplayID: QA_DISPLAY_ID,
    Category: QA_CATEGORY,
    Area: QA_AREA,
    Details: QA_REQUEST_DETAILS,
    Status: "responded",
    CreatedAt: "2026-04-22T10:30:00.000Z",
    MatchedProviders: [QA_PROVIDER_ID],
    MatchedProviderDetails: [buildMatchedProvider()],
    RespondedProvider: QA_PROVIDER_ID,
    RespondedProviderName: QA_PROVIDER_NAME,
    ...overrides,
  };
}

export function buildChatThread(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ThreadID: QA_THREAD_ID,
    TaskID: QA_TASK_ID,
    DisplayID: QA_DISPLAY_ID,
    UserPhone: QA_USER_PHONE,
    ProviderID: QA_PROVIDER_ID,
    ProviderPhone: QA_PROVIDER_PHONE,
    Category: QA_CATEGORY,
    Area: QA_AREA,
    Status: "active",
    CreatedAt: "2026-04-22T10:30:00.000Z",
    UpdatedAt: "2026-04-22T10:31:00.000Z",
    LastMessageAt: "2026-04-22T10:31:00.000Z",
    LastMessageBy: "provider",
    UnreadUserCount: 1,
    UnreadProviderCount: 0,
    ...overrides,
  };
}

export function buildChatMessage(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    MessageID: "MSG-QA-0001",
    ThreadID: QA_THREAD_ID,
    TaskID: QA_TASK_ID,
    SenderType: "provider",
    MessageText: QA_PROVIDER_MESSAGE,
    CreatedAt: "2026-04-22T10:31:00.000Z",
    ReadByUser: "no",
    ReadByProvider: "yes",
    ...overrides,
  };
}

export function buildNeedThread(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ThreadID: QA_NEED_THREAD_ID,
    NeedID: QA_NEED_ID,
    PosterPhone: QA_USER_PHONE,
    ResponderPhone: QA_PROVIDER_PHONE,
    Status: "open",
    LastMessageAt: "22/04/2026 12:30:00",
    LastMessageBy: "responder",
    UnreadPosterCount: 1,
    UnreadResponderCount: 0,
    ...overrides,
  };
}

export function buildNeedMessage(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    MessageID: "NEED-MSG-QA-0001",
    SenderRole: "responder",
    MessageText: "ZZ QA need chat message",
    CreatedAt: "22/04/2026 12:30:00",
    ...overrides,
  };
}

export function buildProviderDashboardResponse(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ok: true,
    provider: {
      ProviderID: QA_PROVIDER_ID,
      ProviderName: QA_PROVIDER_NAME,
      Phone: QA_PROVIDER_PHONE,
      Verified: "yes",
      OtpVerified: "yes",
      PendingApproval: "no",
      Status: "active",
      Services: [{ Category: QA_CATEGORY }],
      Areas: [{ Area: QA_AREA }],
      Analytics: {
        Metrics: {
          TotalRequestsInMyCategories: 3,
          TotalRequestsMatchedToMe: 2,
          TotalRequestsRespondedByMe: 1,
          TotalRequestsAcceptedByMe: 1,
          TotalRequestsCompletedByMe: 0,
          ResponseRate: 50,
          AcceptanceRate: 50,
        },
        AreaDemand: [{ AreaName: QA_AREA, RequestCount: 3 }],
        SelectedAreaDemand: [{ AreaName: QA_AREA, RequestCount: 3 }],
        CategoryDemandByRange: {
          today: [{ CategoryName: QA_CATEGORY, RequestCount: 3 }],
        },
        RecentMatchedRequests: [
          {
            TaskID: QA_TASK_ID,
            DisplayID: QA_DISPLAY_ID,
            Category: QA_CATEGORY,
            Area: QA_AREA,
            Details: QA_REQUEST_DETAILS,
            CreatedAt: "2026-04-22T10:30:00.000Z",
            Responded: false,
            Accepted: false,
            ThreadID: QA_THREAD_ID,
          },
        ],
      },
      AreaCoverage: {
        ActiveApprovedAreas: [{ Area: QA_AREA, Status: "active" }],
        PendingAreaRequests: [{ RequestedArea: "New Area", Status: "pending" }],
        ResolvedOutcomes: [
          {
            RequestedArea: "Old Colony",
            ResolvedCanonicalArea: QA_SECONDARY_AREA,
            CoverageActive: true,
            Status: "mapped",
            ResolvedAt: "2026-04-21T10:30:00.000Z",
          },
        ],
      },
    },
    ...overrides,
  };
}

export function buildAdminDashboardPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ok: true,
    stats: {
      totalProviders: 2,
      verifiedProviders: 1,
      pendingAdminApprovals: 1,
      pendingCategoryRequests: 1,
    },
    providers: [
      {
        ProviderID: QA_PROVIDER_ID,
        ProviderName: QA_PROVIDER_NAME,
        Phone: QA_PROVIDER_PHONE,
        Verified: "yes",
        PendingApproval: "no",
        Category: QA_CATEGORY,
        Areas: QA_AREA,
      },
      {
        ProviderID: "PR-QA-PENDING",
        ProviderName: "ZZ QA Pending Provider",
        Phone: "9999999905",
        Verified: "no",
        PendingApproval: "yes",
        Category: QA_SECONDARY_CATEGORY,
        Areas: QA_SECONDARY_AREA,
      },
    ],
    categoryApplications: [
      {
        RequestID: "CAT-REQ-QA-0001",
        ProviderID: "PR-QA-PENDING",
        ProviderName: "ZZ QA Pending Provider",
        Phone: "9999999905",
        RequestedCategory: "Aquarium Cleaning",
        Status: "pending",
        CreatedAt: "2026-04-22T09:00:00.000Z",
      },
    ],
    categories: COMMON_CATEGORIES.map((category) => ({
      CategoryName: category.name,
      Active: category.active,
    })),
    areas: COMMON_AREAS.map((area) => ({
      AreaName: area,
      Active: "yes",
    })),
    ...overrides,
  };
}

export function buildAdminRequestsPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ok: true,
    requests: [
      {
        TaskID: QA_TASK_ID,
        DisplayID: QA_DISPLAY_ID,
        UserPhone: QA_USER_PHONE,
        Category: QA_CATEGORY,
        Area: QA_AREA,
        Details: QA_REQUEST_DETAILS,
        Status: "RESPONDED",
        CreatedAt: "2026-04-22T10:30:00.000Z",
        SelectedTimeframe: "Today",
        WaitingMinutes: 18,
        ResponseWaitingMinutes: 10,
        Priority: "PRIORITY",
        NeedsAttention: true,
        MatchedProviders: [QA_PROVIDER_ID],
        RespondedProvider: QA_PROVIDER_ID,
        RespondedProviderName: QA_PROVIDER_NAME,
      },
    ],
    metrics: {
      urgentRequestsOpen: 0,
      priorityRequestsOpen: 1,
      overdueRequests: 0,
      needsAttentionCount: 1,
    },
    ...overrides,
  };
}

export function buildNotificationLogsPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ok: true,
    logs: [
      {
        LogID: "LOG-QA-0001",
        CreatedAt: "2026-04-22T10:31:00.000Z",
        TaskID: QA_TASK_ID,
        DisplayID: QA_DISPLAY_ID,
        ProviderID: QA_PROVIDER_ID,
        ProviderPhone: QA_PROVIDER_PHONE,
        Status: "accepted",
        StatusCode: 200,
        MessageId: "wamid.qa",
        ErrorMessage: "",
      },
    ],
    ...overrides,
  };
}

export function buildIssueReportsPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ok: true,
    reports: [
      {
        IssueID: "ISSUE-QA-0001",
        CreatedAt: "2026-04-22T11:00:00.000Z",
        ReporterRole: "user",
        ReporterPhone: QA_USER_PHONE,
        IssueType: "Chat/message problem",
        IssuePage: "Chat",
        Description: "User cannot load thread on first try.",
        Status: "open",
      },
    ],
    ...overrides,
  };
}

export function buildAreaMappingsPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ok: true,
    mappings: [
      {
        CanonicalArea: QA_AREA,
        Active: "yes",
        Aliases: [{ AliasName: "Sardar Pura", Active: "yes" }],
        AliasCount: 1,
      },
    ],
    ...overrides,
  };
}

export function buildUnmappedAreasPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ok: true,
    reviews: [
      {
        ReviewID: "AREA-REVIEW-QA-0001",
        RawArea: "Sardar Pura West",
        Status: "pending",
        Occurrences: 2,
        SourceType: "provider_register",
        SourceRef: QA_PROVIDER_ID,
        FirstSeenAt: "2026-04-22T08:30:00.000Z",
        LastSeenAt: "2026-04-22T09:30:00.000Z",
      },
    ],
    ...overrides,
  };
}

export function buildNeed(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    NeedID: QA_NEED_ID,
    Title: "Need an office assistant",
    Category: "Employee",
    Area: QA_AREA,
    Description: "Need an office assistant for daily admin tasks.",
    CreatedAt: "22/04/2026 10:30:00",
    ExpiresAt: "29/04/2026 10:30:00",
    CurrentStatus: "open",
    IsAnonymous: false,
    ...overrides,
  };
}
