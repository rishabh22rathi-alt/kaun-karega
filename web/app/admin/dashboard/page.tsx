"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAuthSession } from "@/lib/auth";
import { getTaskDisplayLabel } from "@/lib/taskDisplay";
import { getTaskStatusLabel } from "@/lib/taskStatus";

type DashboardStats = {
  totalProviders: number;
  verifiedProviders: number;
  pendingAdminApprovals: number;
  pendingCategoryRequests: number;
};

type CategoryApplication = {
  RequestID: string;
  ProviderID?: string;
  ProviderName: string;
  Phone: string;
  RequestedCategory: string;
  Status: string;
  CreatedAt: string;
  AdminActionBy?: string;
  AdminActionAt?: string;
  AdminActionReason?: string;
};

type AdminProvider = {
  ProviderID: string;
  ProviderName: string;
  Phone: string;
  Verified: string;
  PendingApproval: string;
  Category: string;
  Areas: string;
};

type ManagedCategory = {
  CategoryName: string;
  Active: string;
};

type ManagedArea = {
  AreaName: string;
  Active?: string;
};

type ManagedAreaAlias = {
  AliasName: string;
  Active: string;
};

type UnmappedAreaReview = {
  ReviewID: string;
  RawArea: string;
  Status: string;
  Occurrences: number;
  SourceType: string;
  SourceRef: string;
  FirstSeenAt: string;
  LastSeenAt: string;
  ResolvedCanonicalArea?: string;
};

type ManagedAreaMapping = {
  CanonicalArea: string;
  Active: string;
  Aliases: ManagedAreaAlias[];
  AliasCount: number;
};

type AdminRequest = {
  TaskID: string;
  DisplayID?: string;
  UserPhone: string;
  Category: string;
  Area: string;
  Details: string;
  Status: string;
  RawStatus?: string;
  CreatedAt: string;
  NotifiedAt?: string;
  AssignedProvider: string;
  AssignedProviderName?: string;
  ProviderResponseAt: string;
  RespondedProvider?: string;
  RespondedProviderName?: string;
  LastReminderAt?: string;
  CompletedAt?: string;
  SelectedTimeframe?: string;
  Priority?: "URGENT" | "PRIORITY" | "SAME_DAY" | "FLEXIBLE" | string;
  Deadline?: string;
  IsOverdue?: boolean;
  IsExpired?: boolean;
  NeedsAttention?: boolean;
  AttentionThresholdMinutes?: number;
  MinutesUntilDeadline?: number;
  OverdueMinutes?: number;
  ServiceDate?: string;
  TimeSlot?: string;
  WaitingMinutes: number;
  ResponseWaitingMinutes: number;
  MatchedProviders?: string[];
};

type AdminRequestMetrics = {
  urgentRequestsOpen: number;
  priorityRequestsOpen: number;
  overdueRequests: number;
  needsAttentionCount: number;
};

type AdminChatThread = {
  ThreadID: string;
  TaskID: string;
  DisplayID?: string;
  UserPhone: string;
  UserPhoneMasked?: string;
  ProviderID: string;
  ProviderName?: string;
  LastMessagePreview?: string;
  LastMessageAt: string;
  LastMessageBy?: string;
  ThreadStatus: string;
  ModerationReason?: string;
  LastModeratedAt?: string;
  LastModeratedBy?: string;
  CreatedAt?: string;
  UpdatedAt?: string;
};

type AdminChatMessage = {
  MessageID: string;
  ThreadID: string;
  TaskID: string;
  SenderType: string;
  SenderName?: string;
  SenderPhone?: string;
  MessageText: string;
  MessageType: string;
  CreatedAt: string;
  ModerationStatus?: string;
  FlagReason?: string;
  ContainsBlockedWord?: string;
};

type AdminDashboardResponse = {
  ok?: boolean;
  stats?: Partial<DashboardStats>;
  providers?: AdminProvider[];
  categoryApplications?: CategoryApplication[];
  categories?: ManagedCategory[];
  areas?: ManagedArea[];
  error?: string;
};

type AdminRequestsResponse = {
  ok?: boolean;
  requests?: AdminRequest[];
  metrics?: Partial<AdminRequestMetrics>;
  error?: string;
};

type AdminChatThreadsResponse = {
  ok?: boolean;
  threads?: AdminChatThread[];
  error?: string;
};

type AdminChatThreadDetailResponse = {
  ok?: boolean;
  thread?: AdminChatThread;
  messages?: AdminChatMessage[];
  error?: string;
};

type AdminAreaMappingsResponse = {
  ok?: boolean;
  mappings?: ManagedAreaMapping[];
  error?: string;
};

type AdminUnmappedAreasResponse = {
  ok?: boolean;
  reviews?: UnmappedAreaReview[];
  error?: string;
};

type NotificationLog = {
  LogID: string;
  CreatedAt: string;
  TaskID: string;
  DisplayID?: string;
  ProviderID: string;
  ProviderPhone: string;
  Category?: string;
  Area?: string;
  ServiceTime?: string;
  TemplateName?: string;
  Status: string;
  StatusCode?: number | string;
  MessageId: string;
  ErrorMessage: string;
  RawResponse?: string;
};

type NotificationSummary = {
  taskId: string;
  DisplayID?: string;
  total: number;
  accepted: number;
  failed: number;
  error: number;
  latestCreatedAt: string;
};

type AdminNotificationLogsResponse = {
  ok?: boolean;
  logs?: NotificationLog[];
  error?: string;
};

type AdminNotificationSummaryResponse = {
  ok?: boolean;
  summary?: NotificationSummary;
  error?: string;
};

type IssueReport = {
  IssueID: string;
  CreatedAt: string;
  ReporterRole: string;
  ReporterPhone: string;
  ReporterName?: string;
  IssueType: string;
  IssuePage: string;
  Description: string;
  Status: string;
  Priority?: string;
  AdminNotes?: string;
  ResolvedAt?: string;
};

type AdminIssueReportsResponse = {
  ok?: boolean;
  reports?: IssueReport[];
  error?: string;
};

type ActionState = Record<string, boolean>;

type DashboardSectionKey =
  | "pendingCategoryRequests"
  | "providers"
  | "categoriesManagement"
  | "areasManagement"
  | "reportedIssues"
  | "urgentRequests"
  | "priorityRequests"
  | "sameDayRequests"
  | "flexibleRequests"
  | "needsAttention"
  | "chatMonitoring";

type AccordionSectionProps = {
  sectionKey: DashboardSectionKey;
  title: string;
  description: string;
  count: number;
  isOpen: boolean;
  onToggle: (sectionKey: DashboardSectionKey) => void;
  children: ReactNode;
  className?: string;
  buttonClassName?: string;
  openBorderClassName?: string;
  titleClassName?: string;
  descriptionClassName?: string;
  indicatorClassName?: string;
  headerAction?: ReactNode;
};

function AccordionSection({
  sectionKey,
  title,
  description,
  count,
  isOpen,
  onToggle,
  children,
  className = "border-slate-200",
  buttonClassName = "hover:bg-slate-50",
  openBorderClassName = "border-slate-200",
  titleClassName = "text-slate-900",
  descriptionClassName = "text-slate-500",
  indicatorClassName = "border-slate-200 text-slate-700",
  headerAction,
}: AccordionSectionProps) {
  return (
    <section className={`overflow-hidden rounded-2xl border bg-white shadow-sm ${className}`}>
      <div
        className={`flex items-start justify-between gap-4 px-5 py-4 ${
          isOpen ? `border-b ${openBorderClassName}` : ""
        }`}
      >
        <button
          type="button"
          aria-expanded={isOpen}
          onClick={() => onToggle(sectionKey)}
          className={`min-w-0 flex-1 text-left transition ${buttonClassName}`}
        >
          <span className={`text-lg font-semibold ${titleClassName}`}>
            {title} ({count})
          </span>
          <p className={`mt-1 text-sm ${descriptionClassName}`}>{description}</p>
        </button>
        <div className="flex shrink-0 items-center gap-3">
          {headerAction}
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => onToggle(sectionKey)}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full border text-lg font-semibold transition ${buttonClassName} ${indicatorClassName}`}
          >
            {isOpen ? "-" : "+"}
          </button>
        </div>
      </div>
      {isOpen ? children : null}
    </section>
  );
}

export default function AdminDashboardPage() {
  const [stats, setStats] = useState<DashboardStats>({
    totalProviders: 0,
    verifiedProviders: 0,
    pendingAdminApprovals: 0,
    pendingCategoryRequests: 0,
  });
  const [providers, setProviders] = useState<AdminProvider[]>([]);
  const [categoryApplications, setCategoryApplications] = useState<
    CategoryApplication[]
  >([]);
  const [categories, setCategories] = useState<ManagedCategory[]>([]);
  const [areaMappings, setAreaMappings] = useState<ManagedAreaMapping[]>([]);
  const [unmappedAreas, setUnmappedAreas] = useState<UnmappedAreaReview[]>([]);
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [chatThreads, setChatThreads] = useState<AdminChatThread[]>([]);
  const [selectedChatThread, setSelectedChatThread] = useState<AdminChatThread | null>(null);
  const [selectedChatMessages, setSelectedChatMessages] = useState<AdminChatMessage[]>([]);
  const [notificationLogs, setNotificationLogs] = useState<NotificationLog[]>([]);
  const [issueReports, setIssueReports] = useState<IssueReport[]>([]);
  const [selectedTaskNotificationSummary, setSelectedTaskNotificationSummary] =
    useState<NotificationSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState<"success" | "error" | "">("");
  const [pendingCategoryActions, setPendingCategoryActions] = useState<ActionState>({});
  const [pendingProviderActions, setPendingProviderActions] = useState<ActionState>({});
  const [pendingManagementActions, setPendingManagementActions] = useState<ActionState>({});
  const [pendingIssueActions, setPendingIssueActions] = useState<ActionState>({});
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [editingCategoryName, setEditingCategoryName] = useState("");
  const [editingCategoryValue, setEditingCategoryValue] = useState("");
  const [showAddArea, setShowAddArea] = useState(false);
  const [newAreaName, setNewAreaName] = useState("");
  const [editingAreaName, setEditingAreaName] = useState("");
  const [editingAreaValue, setEditingAreaValue] = useState("");
  const [expandedAreas, setExpandedAreas] = useState<Record<string, boolean>>({});
  const [aliasAreaName, setAliasAreaName] = useState("");
  const [aliasInputValue, setAliasInputValue] = useState("");
  const [editingAliasId, setEditingAliasId] = useState("");
  const [editingAliasValue, setEditingAliasValue] = useState("");
  const [editingAliasCanonicalArea, setEditingAliasCanonicalArea] = useState("");
  const [aliasSaveStatus, setAliasSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [mergeCanonicalArea, setMergeCanonicalArea] = useState("");
  const [mergeSourceArea, setMergeSourceArea] = useState("");
  const [reviewTargetAreas, setReviewTargetAreas] = useState<Record<string, string>>({});
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatDetailLoading, setChatDetailLoading] = useState(false);
  const [chatStatusActionKey, setChatStatusActionKey] = useState("");
  const [assigningTaskId, setAssigningTaskId] = useState("");
  const [assignProviderId, setAssignProviderId] = useState("");
  const [openSections, setOpenSections] = useState<Record<DashboardSectionKey, boolean>>({
    pendingCategoryRequests: true,
    providers: false,
    categoriesManagement: false,
    areasManagement: false,
    reportedIssues: false,
    urgentRequests: true,
    priorityRequests: false,
    sameDayRequests: false,
    flexibleRequests: false,
    needsAttention: true,
    chatMonitoring: false,
  });
  const needsAttentionRef = useRef<HTMLDivElement | null>(null);
  const aliasSaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedbackType(type);
    setFeedback(message);
  };

  const clearFeedback = () => {
    setFeedbackType("");
    setFeedback("");
  };

  const toggleSection = (sectionKey: DashboardSectionKey) => {
    setOpenSections((current) => ({
      ...current,
      [sectionKey]: !current[sectionKey],
    }));
  };

  const sortCategories = (items: ManagedCategory[]) =>
    items
      .slice()
      .sort((a, b) => String(a.CategoryName || "").localeCompare(String(b.CategoryName || "")));

  const sortAreaMappings = (items: ManagedAreaMapping[]) =>
    items
      .slice()
      .map((item) => ({
        ...item,
        Aliases: (Array.isArray(item.Aliases) ? item.Aliases : [])
          .slice()
          .sort((a, b) => String(a.AliasName || "").localeCompare(String(b.AliasName || ""))),
      }))
      .sort((a, b) =>
        String(a.CanonicalArea || "").localeCompare(String(b.CanonicalArea || ""))
      );

  const getAreaManagementRowKey = (canonicalArea: string) => {
    const areaName = String(canonicalArea || "").trim();
    const normalizedKey = areaName.toLowerCase().replace(/\s+/g, " ");
    return `${areaName}-${normalizedKey}`;
  };

  const sortUnmappedAreas = (items: UnmappedAreaReview[]) =>
    items
      .slice()
      .sort(
        (a, b) =>
          new Date(String(b.LastSeenAt || "")).getTime() -
          new Date(String(a.LastSeenAt || "")).getTime()
      );

  const sortRequests = (items: AdminRequest[]) =>
    items
      .slice()
      .sort(
        (a, b) =>
          new Date(String(b.CreatedAt || "")).getTime() -
          new Date(String(a.CreatedAt || "")).getTime()
      );

  const sortIssueReports = (items: IssueReport[]) =>
    items
      .slice()
      .sort(
        (a, b) =>
          new Date(String(b.CreatedAt || "")).getTime() -
          new Date(String(a.CreatedAt || "")).getTime()
      );

  const formatDateTime = (value: string) => {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN");
  };

  const formatMinutes = (minutes: number) => {
    if (!minutes || minutes <= 0) return "0 min";
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  };

  const getNotificationStatusClass = (status: string) => {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "accepted") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (normalized === "failed") return "border-amber-200 bg-amber-50 text-amber-700";
    if (normalized === "error") return "border-red-200 bg-red-50 text-red-700";
    return "border-slate-200 bg-slate-50 text-slate-700";
  };

  const normalizePhone = (value: string) => String(value || "").replace(/\D/g, "").slice(-10);

  const getAdminActor = () => {
    const session = getAuthSession();
    let adminName = "";

    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem("kk_admin_session");
        const parsed = raw ? JSON.parse(raw) : null;
        adminName = String(parsed?.name || "").trim();
      } catch {
        adminName = "";
      }
    }

    return {
      AdminActorPhone: normalizePhone(String(session?.phone || "")),
      AdminActorName: adminName,
    };
  };

  const fetchChatThreads = async () => {
    setChatLoading(true);
    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_list_chat_threads",
        }),
      });
      const data = (await res.json()) as AdminChatThreadsResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to load chat threads");
      }
      const nextThreads = Array.isArray(data.threads) ? data.threads : [];
      setChatThreads(nextThreads);
      setSelectedChatThread((current) => {
        if (!current) return current;
        return nextThreads.find((item) => item.ThreadID === current.ThreadID) || current;
      });
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : "Failed to load chat threads");
    } finally {
      setChatLoading(false);
    }
  };

  const fetchChatThreadDetail = async (threadId: string) => {
    if (!threadId) return;
    setChatDetailLoading(true);
    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_get_chat_thread",
          ThreadID: threadId,
          ...getAdminActor(),
        }),
      });
      const data = (await res.json()) as AdminChatThreadDetailResponse;
      if (!res.ok || !data.ok || !data.thread) {
        throw new Error(data.error || "Failed to load chat thread");
      }
      setSelectedChatThread(data.thread);
      setSelectedChatMessages(Array.isArray(data.messages) ? data.messages : []);
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : "Failed to load chat thread");
    } finally {
      setChatDetailLoading(false);
    }
  };

  const getWaitingToneClass = (minutes: number) => {
    if (minutes > 20) return "bg-red-50";
    if (minutes > 10) return "bg-amber-50";
    return "";
  };

  const getPriorityBadgeClass = (request: AdminRequest) => {
    if (request.IsOverdue) return "border-red-200 bg-red-50 text-red-700";
    if (request.Priority === "URGENT") return "border-red-200 bg-red-50 text-red-700";
    if (request.Priority === "PRIORITY") return "border-orange-200 bg-orange-50 text-orange-700";
    if (request.Priority === "SAME_DAY") return "border-amber-200 bg-amber-50 text-amber-700";
    return "border-sky-200 bg-sky-50 text-sky-700";
  };

  const getPriorityRowClass = (request: AdminRequest) => {
    if (request.IsOverdue) return "bg-red-50/80";
    if (request.NeedsAttention && request.Priority === "URGENT") return "bg-red-50/60";
    if (request.NeedsAttention && request.Priority === "PRIORITY") return "bg-orange-50/70";
    if (request.NeedsAttention && request.Priority === "SAME_DAY") return "bg-amber-50/70";
    if (request.NeedsAttention) return "bg-sky-50/60";
    return "";
  };

  const formatDeadlineState = (request: AdminRequest) => {
    if (request.IsOverdue) {
      return `Overdue by ${formatMinutes(Number(request.OverdueMinutes || 0))}`;
    }
    if (typeof request.MinutesUntilDeadline === "number" && request.Deadline) {
      return `${formatMinutes(Math.max(0, request.MinutesUntilDeadline))} left`;
    }
    return request.Deadline ? formatDateTime(request.Deadline) : "-";
  };

  const recalculateStats = (
    nextProviders: AdminProvider[],
    nextCategoryApplications: CategoryApplication[]
  ) => {
    setStats({
      totalProviders: nextProviders.length,
      verifiedProviders: nextProviders.filter(
        (provider) => String(provider.Verified).trim().toLowerCase() === "yes"
      ).length,
      pendingAdminApprovals: nextProviders.filter(
        (provider) => String(provider.PendingApproval).trim().toLowerCase() === "yes"
      ).length,
      pendingCategoryRequests: nextCategoryApplications.filter(
        (item) => String(item.Status).trim().toLowerCase() === "pending"
      ).length,
    });
  };

  const fetchNotificationSummary = async (taskId: string) => {
    const normalizedTaskId = String(taskId || "").trim();
    if (!normalizedTaskId) {
      setSelectedTaskNotificationSummary(null);
      return;
    }

    const res = await fetch("/api/kk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "admin_notification_summary",
        taskId: normalizedTaskId,
      }),
    });
    const data = (await res.json()) as AdminNotificationSummaryResponse;
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to load notification summary");
    }
    setSelectedTaskNotificationSummary(data.summary || null);
  };

  const fetchDashboard = async () => {
    setLoading(true);
    setError("");
    try {
      // Critical fetches — failure here blocks the entire dashboard (correct behaviour).
      // Non-critical fetches — .catch(() => null) prevents a network-level rejection from
      // propagating into Promise.all and killing the page for a secondary data source.
      const [dashboardRes, requestsRes, areaMappingsRes, unmappedAreasRes, chatThreadsRes, issueReportsRes] =
        await Promise.all([
        fetch("/api/admin/stats", { cache: "no-store" }),
        fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_admin_requests" }),
        }),
        fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "get_admin_area_mappings" }),
        }).catch(() => null),
        fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "admin_get_unmapped_areas" }),
        }).catch(() => null),
        fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "admin_list_chat_threads" }),
        }).catch(() => null),
        fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "admin_get_issue_reports" }),
        }).catch(() => null),
      ]);
      const data = (await dashboardRes.json()) as AdminDashboardResponse;
      const requestsData = (await requestsRes.json()) as AdminRequestsResponse;
      if (!dashboardRes.ok || !data.ok) {
        throw new Error(data.error || "Failed to load admin dashboard");
      }
      if (!requestsRes.ok || !requestsData.ok) {
        throw new Error(requestsData.error || "Failed to load admin requests");
      }

      setStats({
        totalProviders: Number(data.stats?.totalProviders || 0),
        verifiedProviders: Number(data.stats?.verifiedProviders || 0),
        pendingAdminApprovals: Number(data.stats?.pendingAdminApprovals || 0),
        pendingCategoryRequests: Number(data.stats?.pendingCategoryRequests || 0),
      });
      setProviders(Array.isArray(data.providers) ? data.providers : []);
      setCategoryApplications(
        Array.isArray(data.categoryApplications) ? data.categoryApplications : []
      );
      setCategories(sortCategories(Array.isArray(data.categories) ? data.categories : []));
      setRequests(sortRequests(Array.isArray(requestsData.requests) ? requestsData.requests : []));

      // Area mappings: non-fatal. Network error resolves to null; bad HTTP response treated as empty.
      const areaMappingsData: AdminAreaMappingsResponse =
        areaMappingsRes?.ok ? await areaMappingsRes.json().catch(() => ({})) : {};
      setAreaMappings(
        sortAreaMappings(Array.isArray(areaMappingsData.mappings) ? areaMappingsData.mappings : [])
      );

      // Unmapped areas: non-fatal. Same degradation pattern.
      const unmappedAreasData: AdminUnmappedAreasResponse =
        unmappedAreasRes?.ok ? await unmappedAreasRes.json().catch(() => ({})) : {};
      setUnmappedAreas(
        sortUnmappedAreas(Array.isArray(unmappedAreasData.reviews) ? unmappedAreasData.reviews : [])
      );

      const chatThreadsData: AdminChatThreadsResponse =
        chatThreadsRes?.ok ? await chatThreadsRes.json().catch(() => ({})) : {};
      setChatThreads(Array.isArray(chatThreadsData.threads) ? chatThreadsData.threads : []);

      const issueReportsData: AdminIssueReportsResponse =
        issueReportsRes?.ok ? await issueReportsRes.json().catch(() => ({})) : {};
      setIssueReports(
        sortIssueReports(Array.isArray(issueReportsData.reports) ? issueReportsData.reports : [])
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load admin dashboard"
      );
    } finally {
      setLoading(false);
    }

    // Notification logs are non-blocking: a failure here degrades only that panel.
    try {
      const notificationLogsRes = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "admin_notification_logs", limit: 25 }),
      });
      const notificationLogsData =
        (await notificationLogsRes.json()) as AdminNotificationLogsResponse;
      setNotificationLogs(
        notificationLogsRes.ok && notificationLogsData.ok && Array.isArray(notificationLogsData.logs)
          ? notificationLogsData.logs
          : []
      );
    } catch {
      setNotificationLogs([]);
    }
  };

  const fetchAdminRequests = async () => {
    const res = await fetch("/api/kk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_admin_requests" }),
    });
    const data = (await res.json()) as AdminRequestsResponse;
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to load admin requests");
    }
    setRequests(sortRequests(Array.isArray(data.requests) ? data.requests : []));
  };

  const fetchIssueReports = async () => {
    const res = await fetch("/api/kk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_get_issue_reports" }),
    });
    const data = (await res.json()) as AdminIssueReportsResponse;
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to load issue reports");
    }
    setIssueReports(sortIssueReports(Array.isArray(data.reports) ? data.reports : []));
  };

  const fetchAreaMappings = async () => {
    const res = await fetch("/api/kk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get_admin_area_mappings" }),
    });
    const data = (await res.json()) as AdminAreaMappingsResponse;
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to load area mappings");
    }
    setAreaMappings(sortAreaMappings(Array.isArray(data.mappings) ? data.mappings : []));
  };

  const fetchUnmappedAreas = async () => {
    const res = await fetch("/api/kk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin_get_unmapped_areas" }),
    });
    const data = (await res.json()) as AdminUnmappedAreasResponse;
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Failed to load unmapped areas");
    }
    setUnmappedAreas(sortUnmappedAreas(Array.isArray(data.reviews) ? data.reviews : []));
  };

  const refreshAreaAdminState = async () => {
    await Promise.all([fetchAreaMappings(), fetchUnmappedAreas()]);
  };

  const getIssueStatusClass = (status: string) => {
    const normalized = String(status || "").trim().toLowerCase();
    if (normalized === "resolved") return "border-emerald-200 bg-emerald-50 text-emerald-700";
    if (normalized === "in_progress") return "border-amber-200 bg-amber-50 text-amber-700";
    return "border-slate-200 bg-slate-100 text-slate-700";
  };

  const handleIssueStatusUpdate = async (
    issueId: string,
    status: "open" | "in_progress" | "resolved"
  ) => {
    const actionKey = `${issueId}:${status}`;
    setPendingIssueActions((current) => ({ ...current, [actionKey]: true }));
    clearFeedback();

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_update_issue_report_status",
          IssueID: issueId,
          Status: status,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Failed to update issue status");
      }
      await fetchIssueReports();
      showFeedback("success", "Issue status updated successfully");
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : "Failed to update issue status");
    } finally {
      setPendingIssueActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  useEffect(() => {
    void fetchDashboard();
  }, []);

  useEffect(() => {
    if (!selectedRequestId) {
      setSelectedTaskNotificationSummary(null);
      return;
    }

    void fetchNotificationSummary(selectedRequestId).catch((err) => {
      setSelectedTaskNotificationSummary(null);
      showFeedback(
        "error",
        err instanceof Error ? err.message : "Failed to load notification summary"
      );
    });
  }, [selectedRequestId]);

  useEffect(() => {
    return () => {
      if (aliasSaveTimeoutRef.current) {
        clearTimeout(aliasSaveTimeoutRef.current);
      }
    };
  }, []);

  const cards = [
    { title: "Total Providers", value: stats.totalProviders },
    { title: "Verified Providers", value: stats.verifiedProviders },
    { title: "Pending Admin Approvals", value: stats.pendingAdminApprovals },
    { title: "Pending Category Requests", value: stats.pendingCategoryRequests },
  ];

  const pendingCategoryCount = useMemo(
    () =>
      categoryApplications.filter(
        (item) => String(item.Status || "").trim().toLowerCase() === "pending"
      ).length,
    [categoryApplications]
  );

  const pendingCategoryApplications = useMemo(
    () =>
      categoryApplications.filter(
        (item) => String(item.Status || "").trim().toLowerCase() === "pending"
      ),
    [categoryApplications]
  );

  const providersNeedingAttention = useMemo(() => {
    const pendingCategoryPhones = new Set(
      pendingCategoryApplications
        .map((item) => normalizePhone(item.Phone))
        .filter((value) => Boolean(value))
    );

    return providers
      .filter((provider) => {
        const isPendingApproval =
          String(provider.PendingApproval || "").trim().toLowerCase() === "yes";
        const isUnverified = String(provider.Verified || "").trim().toLowerCase() !== "yes";
        const hasPendingCategoryRequest = pendingCategoryPhones.has(normalizePhone(provider.Phone));
        return isPendingApproval || isUnverified || hasPendingCategoryRequest;
      })
      .sort((a, b) => {
        const aPending = String(a.PendingApproval || "").trim().toLowerCase() === "yes" ? 1 : 0;
        const bPending = String(b.PendingApproval || "").trim().toLowerCase() === "yes" ? 1 : 0;
        if (aPending !== bPending) return bPending - aPending;

        const aUnverified = String(a.Verified || "").trim().toLowerCase() !== "yes" ? 1 : 0;
        const bUnverified = String(b.Verified || "").trim().toLowerCase() !== "yes" ? 1 : 0;
        if (aUnverified !== bUnverified) return bUnverified - aUnverified;

        return String(a.ProviderName || "").localeCompare(String(b.ProviderName || ""));
      });
  }, [pendingCategoryApplications, providers]);

  const visibleProvidersNeedingAttention = useMemo(
    () => providersNeedingAttention.slice(0, 10),
    [providersNeedingAttention]
  );

  const requestMetrics = useMemo<AdminRequestMetrics>(() => {
    return {
      urgentRequestsOpen: requests.filter(
        (request) => request.Priority === "URGENT" && request.Status !== "COMPLETED"
      ).length,
      priorityRequestsOpen: requests.filter(
        (request) => request.Priority === "PRIORITY" && request.Status !== "COMPLETED"
      ).length,
      overdueRequests: requests.filter(
        (request) => Boolean(request.IsOverdue) && request.Status !== "COMPLETED"
      ).length,
      needsAttentionCount: requests.filter(
        (request) => Boolean(request.NeedsAttention) && request.Status !== "COMPLETED"
      ).length,
    };
  }, [requests]);

  const sortPrioritizedRequests = (items: AdminRequest[]) =>
    items.slice().sort((a, b) => {
      const overdueDelta = Number(Boolean(b.IsOverdue)) - Number(Boolean(a.IsOverdue));
      if (overdueDelta !== 0) return overdueDelta;

      const attentionDelta = Number(Boolean(b.NeedsAttention)) - Number(Boolean(a.NeedsAttention));
      if (attentionDelta !== 0) return attentionDelta;

      return b.WaitingMinutes - a.WaitingMinutes;
    });

  const openRequests = useMemo(
    () => requests.filter((request) => request.Status !== "COMPLETED"),
    [requests]
  );

  const urgentRequests = useMemo(
    () => sortPrioritizedRequests(openRequests.filter((request) => request.Priority === "URGENT")),
    [openRequests]
  );

  const priorityRequests = useMemo(
    () => sortPrioritizedRequests(openRequests.filter((request) => request.Priority === "PRIORITY")),
    [openRequests]
  );

  const sameDayRequests = useMemo(
    () => sortPrioritizedRequests(openRequests.filter((request) => request.Priority === "SAME_DAY")),
    [openRequests]
  );

  const flexibleRequests = useMemo(
    () =>
      sortPrioritizedRequests(
        openRequests.filter((request) => {
          const priority = String(request.Priority || "").trim().toUpperCase();
          return !priority || priority === "FLEXIBLE";
        })
      ),
    [openRequests]
  );

  const needsAttentionRequests = useMemo(
    () => sortPrioritizedRequests(openRequests.filter((request) => Boolean(request.NeedsAttention))),
    [openRequests]
  );

  const selectedRequest = useMemo(
    () => requests.find((request) => request.TaskID === selectedRequestId) || null,
    [requests, selectedRequestId]
  );
  const requestsByTaskId = useMemo(
    () => new Map(requests.map((request) => [String(request.TaskID || "").trim(), request])),
    [requests]
  );

  // Providers eligible for manual assignment to the task currently being assigned.
  // Primary: MatchedProviders from backend (already category+area aware).
  // Fallback: filter by category string equality.
  const assignableProviders = useMemo(() => {
    if (!assigningTaskId) return providers;
    const task = requests.find((r) => String(r.TaskID || "").trim() === assigningTaskId);
    if (!task) return providers;

    if (Array.isArray(task.MatchedProviders) && task.MatchedProviders.length > 0) {
      const matchedIds = new Set(task.MatchedProviders.map((id) => String(id || "").trim()));
      return providers.filter((p) => matchedIds.has(String(p.ProviderID || "").trim()));
    }

    const taskCategory = String(task.Category || "").trim().toLowerCase();
    if (!taskCategory) return providers;
    return providers.filter(
      (p) => String(p.Category || "").trim().toLowerCase() === taskCategory
    );
  }, [assigningTaskId, requests, providers]);

  const notificationHealth = useMemo(() => {
    return notificationLogs.reduce(
      (acc, log) => {
        acc.total += 1;
        const status = String(log.Status || "").trim().toLowerCase();
        if (status === "accepted") acc.accepted += 1;
        if (status === "failed") acc.failed += 1;
        if (status === "error") acc.error += 1;
        return acc;
      },
      { total: 0, accepted: 0, failed: 0, error: 0 }
    );
  }, [notificationLogs]);

  const toggleAreaExpanded = (canonicalArea: string) => {
    setExpandedAreas((current) => ({
      ...current,
      [canonicalArea]: !current[canonicalArea],
    }));
  };

  const canonicalAreaOptions = useMemo(
    () =>
      areaMappings
        .map((item) => String(item.CanonicalArea || "").trim())
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [areaMappings]
  );

  const handleCategoryRequestAction = async (
    request: CategoryApplication,
    action:
      | "approve_category_request"
      | "reject_category_request"
      | "admin_close_category_request"
      | "admin_archive_category_request"
      | "admin_delete_category_request_soft"
  ) => {
    const requestId = String(request.RequestID || "").trim();
    if (!requestId) return;
    const actionKey = `${action}:${requestId}`;
    const requiresReason = action !== "approve_category_request";
    const actionLabelMap: Record<string, string> = {
      approve_category_request: "approve",
      reject_category_request: "reject",
      admin_close_category_request: "close",
      admin_archive_category_request: "archive",
      admin_delete_category_request_soft: "delete",
    };
    const reason = requiresReason
      ? window.prompt(`Reason required to ${actionLabelMap[action]} request ${requestId}:`, "")?.trim() || ""
      : "";
    if (requiresReason && !reason) return;

    clearFeedback();
    setPendingCategoryActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const payload =
        action === "approve_category_request"
          ? {
              action,
              requestId,
              categoryName: request.RequestedCategory,
              ...getAdminActor(),
              adminActionReason: reason,
            }
          : {
              action,
              requestId,
              reason,
              ...getAdminActor(),
            };

      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await fetchDashboard();
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingCategoryActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleProviderVerification = async (provider: AdminProvider) => {
    const providerId = String(provider.ProviderID || "").trim();
    if (!providerId) return;

    const nextVerified =
      String(provider.Verified || "").trim().toLowerCase() === "yes" ? "no" : "yes";

    clearFeedback();
    setPendingProviderActions((current) => ({ ...current, [providerId]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_provider_verified",
          providerId,
          verified: nextVerified,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      setProviders((current) => {
        const nextProviders = current.map((item) =>
          String(item.ProviderID || "").trim() === providerId
            ? {
                ...item,
                Verified: nextVerified,
                PendingApproval: nextVerified === "yes" ? "no" : item.PendingApproval,
              }
            : item
        );
        recalculateStats(nextProviders, categoryApplications);
        return nextProviders;
      });
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingProviderActions((current) => {
        const next = { ...current };
        delete next[providerId];
        return next;
      });
    }
  };

  const handleProviderApprovalAction = async (
    provider: AdminProvider,
    action: "approve" | "reject"
  ) => {
    const providerId = String(provider.ProviderID || "").trim();
    if (!providerId) return;
    if (action === "reject" && !window.confirm(`Reject provider "${provider.ProviderName || providerId}"? They will be marked as unverified.`)) return;

    const nextVerified = action === "approve" ? "yes" : "no";
    const actionKey = `${action}:${providerId}`;

    clearFeedback();
    setPendingProviderActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_provider_verified",
          providerId,
          verified: nextVerified,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      setProviders((current) => {
        const nextProviders = current.map((item) =>
          String(item.ProviderID || "").trim() === providerId
            ? { ...item, Verified: nextVerified, PendingApproval: "no" }
            : item
        );
        recalculateStats(nextProviders, categoryApplications);
        return nextProviders;
      });
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingProviderActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleAddCategory = async () => {
    const categoryName = String(newCategoryName || "").trim();
    if (!categoryName) return;

    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, addCategory: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_category",
          categoryName,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      setCategories((current) =>
        sortCategories([...current, { CategoryName: categoryName, Active: "yes" }])
      );
      setNewCategoryName("");
      setShowAddCategory(false);
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next.addCategory;
        return next;
      });
    }
  };

  const handleEditCategory = async (oldName: string) => {
    const newName = String(editingCategoryValue || "").trim();
    if (!oldName || !newName) return;

    const actionKey = `edit-category:${oldName}`;
    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit_category",
          oldName,
          newName,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      setCategories((current) =>
        sortCategories(
          current.map((item) =>
            item.CategoryName === oldName ? { ...item, CategoryName: newName } : item
          )
        )
      );
      setEditingCategoryName("");
      setEditingCategoryValue("");
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleToggleCategory = async (category: ManagedCategory) => {
    const categoryName = String(category.CategoryName || "").trim();
    if (!categoryName) return;

    const nextActive = String(category.Active || "").trim().toLowerCase() === "yes" ? "no" : "yes";
    if (nextActive === "no" && !window.confirm(`Disable category "${categoryName}"? This will affect live provider matching.`)) return;
    const actionKey = `toggle-category:${categoryName}`;
    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "toggle_category",
          categoryName,
          active: nextActive,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      setCategories((current) =>
        sortCategories(
          current.map((item) =>
            item.CategoryName === categoryName ? { ...item, Active: nextActive } : item
          )
        )
      );
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleAddArea = async () => {
    const areaName = String(newAreaName || "").trim();
    if (!areaName) return;

    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, addArea: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_area",
          areaName,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await fetchAreaMappings();
      setNewAreaName("");
      setShowAddArea(false);
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next.addArea;
        return next;
      });
    }
  };

  const handleEditArea = async (oldArea: string) => {
    const newArea = String(editingAreaValue || "").trim();
    if (!oldArea || !newArea) return;

    const actionKey = `edit-area:${oldArea}`;
    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "edit_area",
          oldArea,
          newArea,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await fetchAreaMappings();
      setEditingAreaName("");
      setEditingAreaValue("");
      setAliasAreaName("");
      setAliasInputValue("");
      setMergeCanonicalArea("");
      setMergeSourceArea("");
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleAddAreaAlias = async (canonicalArea: string) => {
    const aliasName = String(aliasInputValue || "").trim();
    if (!canonicalArea || !aliasName) return;

    const actionKey = `add-alias:${canonicalArea}`;
    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_add_area_alias",
          aliasName,
          canonicalArea,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      void refreshAreaAdminState();
      setAliasAreaName("");
      setAliasInputValue("");
      setExpandedAreas((current) => ({ ...current, [canonicalArea]: true }));
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleUpdateAreaAlias = async (oldAliasName: string, currentCanonicalArea: string) => {
    const newAliasName = String(editingAliasValue || "").trim();
    const canonicalArea = String(editingAliasCanonicalArea || currentCanonicalArea || "").trim();
    if (!oldAliasName || !newAliasName || !canonicalArea) return;

    const actionKey = `edit-alias:${oldAliasName}`;
    let pendingCleared = false;
    const clearPendingAction = () => {
      pendingCleared = true;
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    };
    clearFeedback();
    if (aliasSaveTimeoutRef.current) {
      clearTimeout(aliasSaveTimeoutRef.current);
      aliasSaveTimeoutRef.current = null;
    }
    setAliasSaveStatus("saving");
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_update_area_alias",
          oldAliasName,
          newAliasName,
          canonicalArea,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      clearPendingAction();
      setExpandedAreas((current) => ({ ...current, [canonicalArea]: true }));
      showFeedback("success", "Action completed successfully");
      setAliasSaveStatus("saved");
      // Delay refresh to allow "Saved" state to be visible for 800ms
      setTimeout(async () => {
        await refreshAreaAdminState();
      }, 800);
      aliasSaveTimeoutRef.current = setTimeout(() => {
        setEditingAliasId("");
        setEditingAliasValue("");
        setEditingAliasCanonicalArea("");
        setAliasSaveStatus("idle");
        aliasSaveTimeoutRef.current = null;
      }, 1400);
    } catch {
      setAliasSaveStatus("idle");
      showFeedback("error", "Failed to update");
    } finally {
      if (!pendingCleared) {
        clearPendingAction();
      }
    }
  };

  const handleToggleAreaAlias = async (
    aliasName: string,
    canonicalArea: string,
    nextActive: "yes" | "no"
  ) => {
    if (!aliasName) return;

    const actionKey = `toggle-alias:${aliasName}`;
    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_toggle_area_alias",
          aliasName,
          active: nextActive,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await refreshAreaAdminState();
      setExpandedAreas((current) => ({ ...current, [canonicalArea]: true }));
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleMergeArea = async (canonicalArea: string) => {
    const sourceArea = String(mergeSourceArea || "").trim();
    if (!canonicalArea || !sourceArea) return;

    const actionKey = `merge-area:${canonicalArea}`;
    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "merge_area_into_canonical",
          sourceArea,
          canonicalArea,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await fetchAreaMappings();
      setMergeCanonicalArea("");
      setMergeSourceArea("");
      setExpandedAreas((current) => ({ ...current, [canonicalArea]: true }));
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleMapUnmappedArea = async (review: UnmappedAreaReview) => {
    const reviewId = String(review.ReviewID || "").trim();
    const rawArea = String(review.RawArea || "").trim();
    const canonicalArea = String(reviewTargetAreas[reviewId] || "").trim();
    if (!reviewId || !rawArea || !canonicalArea) return;

    const actionKey = `map-review:${reviewId}`;
    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_map_unmapped_area",
          reviewId,
          rawArea,
          canonicalArea,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await refreshAreaAdminState();
      setReviewTargetAreas((current) => {
        const next = { ...current };
        delete next[reviewId];
        return next;
      });
      setExpandedAreas((current) => ({ ...current, [canonicalArea]: true }));
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleCreateAreaFromUnmapped = async (review: UnmappedAreaReview) => {
    const reviewId = String(review.ReviewID || "").trim();
    const rawArea = String(review.RawArea || "").trim();
    if (!reviewId || !rawArea) return;

    const actionKey = `create-review-area:${reviewId}`;
    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_create_area_from_unmapped",
          reviewId,
          rawArea,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await refreshAreaAdminState();
      setExpandedAreas((current) => ({ ...current, [rawArea]: true }));
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleResolveUnmappedArea = async (review: UnmappedAreaReview) => {
    const reviewId = String(review.ReviewID || "").trim();
    if (!reviewId) return;
    if (!window.confirm(`Mark "${review.RawArea}" as resolved? It will be removed from the unmapped area review list.`)) return;

    const actionKey = `resolve-review:${reviewId}`;
    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_resolve_unmapped_area",
          reviewId,
          resolvedCanonicalArea: review.ResolvedCanonicalArea || "",
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await fetchUnmappedAreas();
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleRemindProviders = async (taskId: string) => {
    if (!taskId) return;

    const actionKey = `remind:${taskId}`;
    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remind_providers",
          taskId,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await fetchAdminRequests();
      showFeedback("success", "Reminder sent to providers");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleAssignProvider = async (taskId: string) => {
    if (!taskId || !assignProviderId) return;

    const actionKey = `assign:${taskId}`;
    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign_provider",
          taskId,
          providerId: assignProviderId,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await fetchAdminRequests();
      setAssigningTaskId("");
      setAssignProviderId("");
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleCloseRequest = async (taskId: string) => {
    if (!taskId) return;

    const actionKey = `close:${taskId}`;
    clearFeedback();
    setPendingManagementActions((current) => ({ ...current, [actionKey]: true }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "close_request",
          taskId,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await fetchAdminRequests();
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingManagementActions((current) => {
        const next = { ...current };
        delete next[actionKey];
        return next;
      });
    }
  };

  const handleChatThreadStatusUpdate = async (
    thread: AdminChatThread,
    nextStatus: "active" | "flagged" | "muted" | "locked" | "closed"
  ) => {
    const threadId = String(thread.ThreadID || "").trim();
    if (!threadId) return;
    const requiresReason = nextStatus === "flagged" || nextStatus === "locked" || nextStatus === "closed";
    const reason = requiresReason
      ? window.prompt(`Reason required to mark thread ${threadId} as ${nextStatus}:`, "")?.trim() || ""
      : "";
    if (requiresReason && !reason) return;

    const actionKey = `${nextStatus}:${threadId}`;
    clearFeedback();
    setChatStatusActionKey(actionKey);

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "admin_update_chat_thread_status",
          ThreadID: threadId,
          ThreadStatus: nextStatus,
          Reason: reason,
          ...getAdminActor(),
        }),
      });
      const data = (await res.json()) as AdminChatThreadDetailResponse;
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update chat thread");
      }

      await fetchChatThreads();
      await fetchChatThreadDetail(threadId);
      showFeedback("success", "Chat thread updated successfully");
    } catch {
      showFeedback("error", "Failed to update chat thread");
    } finally {
      setChatStatusActionKey("");
    }
  };

  const renderRequestActions = (request: AdminRequest) => {
    const remindKey = `remind:${request.TaskID}`;
    const assignKey = `assign:${request.TaskID}`;
    const closeKey = `close:${request.TaskID}`;
    const isAssigning = assigningTaskId === request.TaskID;
    const isAwaitingAssignment =
      request.Status === "NOTIFIED" && !String(request.AssignedProvider || "").trim();
    const canShowClose = request.Status === "RESPONDED" || request.Status === "ASSIGNED";

    if (isAssigning) {
      return (
        <div className="flex justify-end gap-2">
          <select
            value={assignProviderId}
            onChange={(event) => setAssignProviderId(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
          >
            <option value="">Select provider</option>
            {assignableProviders.map((provider) => (
              <option key={provider.ProviderID} value={provider.ProviderID}>
                {provider.ProviderName || provider.ProviderID}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!assignProviderId || Boolean(pendingManagementActions[assignKey])}
            onClick={() => void handleAssignProvider(request.TaskID)}
            className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          >
            {pendingManagementActions[assignKey] ? "Saving..." : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAssigningTaskId("");
              setAssignProviderId("");
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      );
    }

    if (request.Status === "NEW") {
      return (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={Boolean(pendingManagementActions[remindKey])}
            onClick={() => void handleRemindProviders(request.TaskID)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          >
            {pendingManagementActions[remindKey] ? "Running..." : "Run Matching"}
          </button>
          <button
            type="button"
            onClick={() => setSelectedRequestId(request.TaskID)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            View Details
          </button>
        </div>
      );
    }

    if (isAwaitingAssignment) {
      return (
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={Boolean(pendingManagementActions[remindKey])}
            onClick={() => void handleRemindProviders(request.TaskID)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          >
            {pendingManagementActions[remindKey] ? "Sending..." : "Notify Providers"}
          </button>
          <button
            type="button"
            onClick={() => {
              setAssigningTaskId(request.TaskID);
              setAssignProviderId("");
            }}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            Assign Provider
          </button>
        </div>
      );
    }

    return (
      <div className="flex justify-end gap-2">
        <a
          href="/admin/chats"
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
        >
          Open Chat
        </a>
        <button
          type="button"
          onClick={() => setSelectedRequestId(request.TaskID)}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
        >
          View Details
        </button>
        {canShowClose ? (
          <button
            type="button"
            disabled={Boolean(pendingManagementActions[closeKey])}
            onClick={() => void handleCloseRequest(request.TaskID)}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
          >
            {pendingManagementActions[closeKey] ? "Closing..." : "Close Request"}
          </button>
        ) : null}
      </div>
    );
  };

  return (
    <div className="min-w-0 space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">
          Admin Dashboard
        </p>
        <h1 className="text-3xl font-bold text-slate-900">Control Center</h1>
        <p className="mt-1 text-slate-600">
          Review provider onboarding and category requests from one place.
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">
            Dashboard snapshot
          </p>
          <p className="text-sm text-slate-500">
            {pendingCategoryCount} category requests currently need review.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchDashboard}
          className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
        >
          {loading ? "Refreshing..." : "Refresh Data"}
        </button>
      </div>

      {error ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      {feedback ? (
        <div
          className={`rounded-2xl border px-4 py-3 text-sm ${
            feedbackType === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {feedback}
        </div>
      ) : null}

      {requestMetrics.needsAttentionCount > 0 ? (
        <button
          type="button"
          onClick={() => needsAttentionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
          className="w-full rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm font-semibold text-amber-800 shadow-sm"
        >
          {`⚠ ${requestMetrics.needsAttentionCount} requests waiting for response`}
        </button>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <div
            key={card.title}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <p className="text-sm font-semibold text-slate-500">{card.title}</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{card.value}</p>
          </div>
        ))}
      </div>

      <AccordionSection
        sectionKey="pendingCategoryRequests"
        title="Pending Category Requests"
        description="Approve, reject, close, archive, or soft-delete requests inline."
        count={pendingCategoryApplications.length}
        isOpen={openSections.pendingCategoryRequests}
        onToggle={toggleSection}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">RequestID</th>
                <th className="px-4 py-3 font-semibold">ProviderName</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">RequestedCategory</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">CreatedAt</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
              {!loading && pendingCategoryApplications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                    No category requests found.
                  </td>
                </tr>
              ) : null}
              {pendingCategoryApplications.map((item) => {
                const requestId = String(item.RequestID || "").trim();
                const isApprovePending = Boolean(
                  pendingCategoryActions[`approve_category_request:${requestId}`]
                );
                const isRejectPending = Boolean(
                  pendingCategoryActions[`reject_category_request:${requestId}`]
                );
                const isClosePending = Boolean(
                  pendingCategoryActions[`admin_close_category_request:${requestId}`]
                );
                const isArchivePending = Boolean(
                  pendingCategoryActions[`admin_archive_category_request:${requestId}`]
                );
                const isDeletePending = Boolean(
                  pendingCategoryActions[`admin_delete_category_request_soft:${requestId}`]
                );
                const isPending =
                  isApprovePending ||
                  isRejectPending ||
                  isClosePending ||
                  isArchivePending ||
                  isDeletePending;

                return (
                <tr key={`${item.RequestID}-${item.RequestedCategory}`}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {item.RequestID || "-"}
                  </td>
                  <td className="px-4 py-3">{item.ProviderName || "-"}</td>
                  <td className="px-4 py-3">{item.Phone || "-"}</td>
                  <td className="px-4 py-3">{item.RequestedCategory || "-"}</td>
                  <td className="px-4 py-3">
                    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                      {item.Status || "pending"}
                    </span>
                  </td>
                  <td className="px-4 py-3">{item.CreatedAt || "-"}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          void handleCategoryRequestAction(item, "approve_category_request")
                        }
                        className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                      >
                        {isApprovePending ? "Updating..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          void handleCategoryRequestAction(item, "reject_category_request")
                        }
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                      >
                        {isRejectPending ? "Updating..." : "Reject"}
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          void handleCategoryRequestAction(item, "admin_close_category_request")
                        }
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                      >
                        {isClosePending ? "Updating..." : "Close"}
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          void handleCategoryRequestAction(item, "admin_archive_category_request")
                        }
                        className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                      >
                        {isArchivePending ? "Updating..." : "Archive"}
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          void handleCategoryRequestAction(item, "admin_delete_category_request_soft")
                        }
                        className="rounded-lg border border-rose-200 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                      >
                        {isDeletePending ? "Updating..." : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AccordionSection>

      <div ref={needsAttentionRef}>
        <AccordionSection
          sectionKey="needsAttention"
          title="Needs Attention"
          description="Requests waiting more than 20 minutes without an assigned provider."
          count={needsAttentionRequests.length}
          isOpen={openSections.needsAttention}
          onToggle={toggleSection}
          className="border-red-200"
          buttonClassName="hover:bg-red-50/50"
          openBorderClassName="border-red-100"
          indicatorClassName="border-red-200 text-red-700"
        >
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead className="bg-red-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Kaam</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Area</th>
                  <th className="px-4 py-3 font-semibold">Waiting</th>
                  <th className="px-4 py-3 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
                {!loading && needsAttentionRequests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      No requests need attention.
                    </td>
                  </tr>
                ) : null}
                {needsAttentionRequests.map((request) => {
                  const remindKey = `remind:${request.TaskID}`;
                  const assignKey = `assign:${request.TaskID}`;
                  const isAssigning = assigningTaskId === request.TaskID;

                  return (
                    <tr key={request.TaskID} className="bg-red-50/60">
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {getTaskDisplayLabel(request, request.TaskID)}
                      </td>
                      <td className="px-4 py-3">{request.Category || "-"}</td>
                      <td className="px-4 py-3">{request.Area || "-"}</td>
                      <td className="px-4 py-3">{formatMinutes(request.WaitingMinutes)}</td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {isAssigning ? (
                            <>
                              <select
                                value={assignProviderId}
                                onChange={(event) => setAssignProviderId(event.target.value)}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900"
                              >
                                <option value="">Select provider</option>
                                {assignableProviders.map((provider) => (
                                  <option key={provider.ProviderID} value={provider.ProviderID}>
                                    {provider.ProviderName || provider.ProviderID}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                disabled={!assignProviderId || Boolean(pendingManagementActions[assignKey])}
                                onClick={() => void handleAssignProvider(request.TaskID)}
                                className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                              >
                                {pendingManagementActions[assignKey] ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAssigningTaskId("");
                                  setAssignProviderId("");
                                }}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                disabled={Boolean(pendingManagementActions[remindKey])}
                                onClick={() => void handleRemindProviders(request.TaskID)}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                              >
                                {pendingManagementActions[remindKey] ? "Sending..." : "Notify Providers"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setAssigningTaskId(request.TaskID);
                                  setAssignProviderId("");
                                }}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                              >
                                Assign Provider
                              </button>
                              <a
                                href={`tel:${request.UserPhone}`}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                              >
                                Call User
                              </a>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </AccordionSection>
      </div>

      <AccordionSection
        sectionKey="providers"
        title="Providers Needing Attention"
        description="Compact list of providers that currently need admin review."
        count={visibleProvidersNeedingAttention.length}
        isOpen={openSections.providers}
        onToggle={toggleSection}
        headerAction={
          <Link
            href="/admin"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            View All Providers
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">ProviderID</th>
                <th className="px-4 py-3 font-semibold">ProviderName</th>
                <th className="px-4 py-3 font-semibold">Phone</th>
                <th className="px-4 py-3 font-semibold">Verified</th>
                <th className="px-4 py-3 font-semibold">PendingApproval</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
              {!loading && visibleProvidersNeedingAttention.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-slate-500">
                    No providers need attention right now.
                  </td>
                </tr>
              ) : null}
              {visibleProvidersNeedingAttention.map((provider) => {
                const providerId = String(provider.ProviderID || "").trim();
                const isUpdating = Boolean(pendingProviderActions[providerId]);
                const isVerified =
                  String(provider.Verified || "").trim().toLowerCase() === "yes";
                const isPendingApproval =
                  String(provider.PendingApproval || "").trim().toLowerCase() === "yes";
                const isApproving = Boolean(pendingProviderActions[`approve:${providerId}`]);
                const isRejecting = Boolean(pendingProviderActions[`reject:${providerId}`]);

                return (
                <tr key={provider.ProviderID || provider.Phone}>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {provider.ProviderID || "-"}
                  </td>
                  <td className="px-4 py-3">{provider.ProviderName || "-"}</td>
                  <td className="px-4 py-3">{provider.Phone || "-"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                        String(provider.Verified).trim().toLowerCase() === "yes"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-slate-200 bg-slate-100 text-slate-700"
                      }`}
                    >
                      {provider.Verified || "no"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                        String(provider.PendingApproval).trim().toLowerCase() === "yes"
                          ? "border-amber-200 bg-amber-50 text-amber-700"
                          : "border-slate-200 bg-slate-100 text-slate-700"
                      }`}
                    >
                      {provider.PendingApproval || "no"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {isPendingApproval ? (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={isApproving || isRejecting || !providerId}
                          onClick={() => void handleProviderApprovalAction(provider, "approve")}
                          className="rounded-lg border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                        >
                          {isApproving ? "Updating..." : "Approve"}
                        </button>
                        <button
                          type="button"
                          disabled={isApproving || isRejecting || !providerId}
                          onClick={() => void handleProviderApprovalAction(provider, "reject")}
                          className="rounded-lg border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                        >
                          {isRejecting ? "Updating..." : "Reject"}
                        </button>
                      </div>
                    ) : (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          disabled={isUpdating || !providerId}
                          onClick={() => void handleProviderVerification(provider)}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                        >
                          {isUpdating ? "Updating..." : isVerified ? "Unverify" : "Verify"}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {providersNeedingAttention.length > visibleProvidersNeedingAttention.length ? (
          <p className="px-5 py-3 text-xs text-slate-500">
            Showing first {visibleProvidersNeedingAttention.length} of {providersNeedingAttention.length} providers needing attention. Use View All Providers to see the full list.
          </p>
        ) : null}
      </AccordionSection>

      <AccordionSection
        sectionKey="categoriesManagement"
        title="Categories Management"
        description="Add, rename, and enable or disable categories."
        count={categories.length}
        isOpen={openSections.categoriesManagement}
        onToggle={toggleSection}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setShowAddCategory((current) => !current);
                setNewCategoryName("");
              }}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Add Category
            </button>
          </div>
          {showAddCategory ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={newCategoryName}
                onChange={(event) => setNewCategoryName(event.target.value)}
                placeholder="Enter category name"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={Boolean(pendingManagementActions.addCategory)}
                  onClick={() => void handleAddCategory()}
                  className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                >
                  {pendingManagementActions.addCategory ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddCategory(false);
                    setNewCategoryName("");
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Category Name</th>
                <th className="px-4 py-3 font-semibold">Active</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
              {!loading && categories.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-4 py-6 text-center text-slate-500">
                    No categories found.
                  </td>
                </tr>
              ) : null}
              {categories.map((category) => {
                const categoryName = String(category.CategoryName || "").trim();
                const isEditing = editingCategoryName === categoryName;
                const toggleKey = `toggle-category:${categoryName}`;
                const editKey = `edit-category:${categoryName}`;
                const isActive = String(category.Active || "").trim().toLowerCase() === "yes";

                return (
                  <tr key={categoryName}>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          value={editingCategoryValue}
                          onChange={(event) => setEditingCategoryValue(event.target.value)}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
                        />
                      ) : (
                        categoryName || "-"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                          isActive
                            ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                            : "border-slate-200 bg-slate-100 text-slate-700"
                        }`}
                      >
                        {isActive ? "yes" : "no"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              disabled={Boolean(pendingManagementActions[editKey])}
                              onClick={() => void handleEditCategory(categoryName)}
                              className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                            >
                              {pendingManagementActions[editKey] ? "Saving..." : "Save"}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCategoryName("");
                                setEditingCategoryValue("");
                              }}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCategoryName(categoryName);
                                setEditingCategoryValue(categoryName);
                              }}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(pendingManagementActions[toggleKey])}
                              onClick={() => void handleToggleCategory(category)}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                            >
                              {pendingManagementActions[toggleKey]
                                ? "Updating..."
                                : isActive
                                ? "Disable"
                                : "Enable"}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AccordionSection>

      <AccordionSection
        sectionKey="areasManagement"
        title="Areas Management"
        description="Manage canonical areas, aliases, and duplicate merges."
        count={areaMappings.length}
        isOpen={openSections.areasManagement}
        onToggle={toggleSection}
      >
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setShowAddArea((current) => !current);
                setNewAreaName("");
              }}
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800"
            >
              Add Area
            </button>
          </div>
          {showAddArea ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                value={newAreaName}
                onChange={(event) => setNewAreaName(event.target.value)}
                placeholder="Enter area name"
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={Boolean(pendingManagementActions.addArea)}
                  onClick={() => void handleAddArea()}
                  className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                >
                  {pendingManagementActions.addArea ? "Saving..." : "Save"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowAddArea(false);
                    setNewAreaName("");
                  }}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Canonical Area</th>
                <th className="px-4 py-3 font-semibold">Aliases</th>
                <th className="px-4 py-3 font-semibold">Active</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
              {!loading && areaMappings.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                    No areas found.
                  </td>
                </tr>
              ) : null}
              {areaMappings.map((area) => {
                const areaName = String(area.CanonicalArea || "").trim();
                const areaRowKey = getAreaManagementRowKey(areaName);
                const isEditing = editingAreaName === areaName;
                const editKey = `edit-area:${areaName}`;
                const aliasKey = `add-alias:${areaName}`;
                const mergeKey = `merge-area:${areaName}`;
                const isExpanded = Boolean(expandedAreas[areaName]);
                const isActive = String(area.Active || "yes").trim().toLowerCase() === "yes";
                const previewAliases = area.Aliases.slice(0, 3).map((item) => item.AliasName).join(", ");

                return (
                  <Fragment key={`area-fragment:${areaRowKey}`}>
                    <tr key={`area-row:${areaRowKey}`}>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            value={editingAreaValue}
                            onChange={(event) => setEditingAreaValue(event.target.value)}
                            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
                          />
                        ) : (
                          <div className="space-y-1">
                            <p className="font-medium text-slate-900">{areaName || "-"}</p>
                            {previewAliases ? (
                              <p className="text-xs text-slate-500">Aliases: {previewAliases}</p>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <p className="font-medium text-slate-900">{area.AliasCount || 0}</p>
                          <p className="text-xs text-slate-500">
                            {area.AliasCount ? "mapped aliases" : "no aliases"}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                            isActive
                              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                              : "border-slate-200 bg-slate-100 text-slate-700"
                          }`}
                        >
                          {isActive ? "yes" : "no"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                disabled={Boolean(pendingManagementActions[editKey])}
                                onClick={() => void handleEditArea(areaName)}
                                className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                              >
                                {pendingManagementActions[editKey] ? "Saving..." : "Save"}
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingAreaName("");
                                  setEditingAreaValue("");
                                }}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                              >
                                Cancel
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingAreaName(areaName);
                                  setEditingAreaValue(areaName);
                                }}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedAreas((current) => ({ ...current, [areaName]: true }));
                                  setAliasAreaName(areaName);
                                  setAliasInputValue("");
                                  setMergeCanonicalArea("");
                                  setMergeSourceArea("");
                                }}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                              >
                                Add Alias
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setExpandedAreas((current) => ({ ...current, [areaName]: true }));
                                  setMergeCanonicalArea(areaName);
                                  setMergeSourceArea("");
                                  setAliasAreaName("");
                                  setAliasInputValue("");
                                }}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                              >
                                Merge Another Area
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleAreaExpanded(areaName)}
                                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                              >
                                {isExpanded ? "Hide Aliases" : "View Aliases"}
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                    {isExpanded ? (
                      <tr key={`area-aliases:${areaRowKey}`} className="bg-slate-50/60">
                        <td colSpan={4} className="px-4 py-4">
                            <div className="grid gap-4 lg:grid-cols-3">
                              <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <p className="text-sm font-semibold text-slate-900">Aliases</p>
                                <div className="mt-3 space-y-3">
                                  {area.Aliases.length ? (
                                    area.Aliases.map((alias) => {
                                      const aliasNameValue = String(alias.AliasName || "").trim();
                                      const aliasId = `${areaName}::${aliasNameValue}`;
                                      const aliasEditKey = `edit-alias:${aliasNameValue}`;
                                      const aliasToggleKey = `toggle-alias:${aliasNameValue}`;
                                      const aliasActive =
                                        String(alias.Active || "yes").trim().toLowerCase() === "yes";
                                      const isAliasEditing = editingAliasId === aliasId;

                                      return (
                                        <div
                                          key={aliasId}
                                          className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                                        >
                                          {isAliasEditing ? (
                                            <div className="space-y-3">
                                              <input
                                                value={editingAliasValue}
                                                onChange={(event) => setEditingAliasValue(event.target.value)}
                                                placeholder="Alias name"
                                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
                                              />
                                              <input
                                                list="admin-area-canonical-options"
                                                value={editingAliasCanonicalArea}
                                                onChange={(event) =>
                                                  setEditingAliasCanonicalArea(event.target.value)
                                                }
                                                placeholder="Canonical area"
                                                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
                                              />
                                              <div className="flex gap-2">
                                                <button
                                                  type="button"
                                                  disabled={aliasSaveStatus === "saving"}
                                                  onClick={() =>
                                                    void handleUpdateAreaAlias(aliasNameValue, areaName)
                                                  }
                                                  className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                                                >
                                                  {aliasSaveStatus === "saving"
                                                    ? "Saving..."
                                                    : aliasSaveStatus === "saved"
                                                      ? "Saved"
                                                      : "Save"}
                                                </button>
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    if (aliasSaveTimeoutRef.current) {
                                                      clearTimeout(aliasSaveTimeoutRef.current);
                                                      aliasSaveTimeoutRef.current = null;
                                                    }
                                                    setEditingAliasId("");
                                                    setEditingAliasValue("");
                                                    setEditingAliasCanonicalArea("");
                                                    setAliasSaveStatus("idle");
                                                  }}
                                                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                                                >
                                                  Cancel
                                                </button>
                                              </div>
                                            </div>
                                          ) : (
                                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                              <div>
                                                <p className="text-sm font-medium text-slate-900">
                                                  {aliasNameValue}
                                                </p>
                                                <p className="text-xs text-slate-500">
                                                  {aliasActive ? "active alias" : "inactive alias"}
                                                </p>
                                              </div>
                                              <div className="flex flex-wrap gap-2">
                                                <button
                                                  type="button"
                                                  onClick={() => {
                                                    if (aliasSaveTimeoutRef.current) {
                                                      clearTimeout(aliasSaveTimeoutRef.current);
                                                      aliasSaveTimeoutRef.current = null;
                                                    }
                                                    setEditingAliasId(aliasId);
                                                    setEditingAliasValue(aliasNameValue);
                                                    setEditingAliasCanonicalArea(areaName);
                                                    setAliasSaveStatus("idle");
                                                  }}
                                                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                                                >
                                                  Edit
                                                </button>
                                                <button
                                                  type="button"
                                                  disabled={Boolean(pendingManagementActions[aliasToggleKey])}
                                                  onClick={() =>
                                                    void handleToggleAreaAlias(
                                                      aliasNameValue,
                                                      areaName,
                                                      aliasActive ? "no" : "yes"
                                                    )
                                                  }
                                                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                                                >
                                                  {pendingManagementActions[aliasToggleKey]
                                                    ? "Saving..."
                                                    : aliasActive
                                                      ? "Deactivate"
                                                      : "Reactivate"}
                                                </button>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <p className="text-sm text-slate-500">No aliases mapped.</p>
                                  )}
                                </div>
                              </div>

                              <div className="rounded-xl border border-slate-200 bg-white p-4">
                                <p className="text-sm font-semibold text-slate-900">Add Alias</p>
                                <div className="mt-3 space-y-3">
                                  <input
                                  value={aliasAreaName === areaName ? aliasInputValue : ""}
                                  onChange={(event) => {
                                    setAliasAreaName(areaName);
                                    setAliasInputValue(event.target.value);
                                  }}
                                  placeholder="e.g. Air Force Rd"
                                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    disabled={
                                      aliasAreaName !== areaName ||
                                      Boolean(pendingManagementActions[aliasKey])
                                    }
                                    onClick={() => void handleAddAreaAlias(areaName)}
                                    className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                                  >
                                    {pendingManagementActions[aliasKey] ? "Saving..." : "Save Alias"}
                                  </button>
                                  {aliasAreaName === areaName ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAliasAreaName("");
                                        setAliasInputValue("");
                                      }}
                                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                                    >
                                      Cancel
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </div>

                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                              <p className="text-sm font-semibold text-slate-900">Merge Duplicate Area</p>
                              <div className="mt-3 space-y-3">
                                <input
                                  value={mergeCanonicalArea === areaName ? mergeSourceArea : ""}
                                  onChange={(event) => {
                                    setMergeCanonicalArea(areaName);
                                    setMergeSourceArea(event.target.value);
                                  }}
                                  placeholder="e.g. airforce"
                                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
                                />
                                <div className="flex gap-2">
                                  <button
                                    type="button"
                                    disabled={
                                      mergeCanonicalArea !== areaName ||
                                      Boolean(pendingManagementActions[mergeKey])
                                    }
                                    onClick={() => void handleMergeArea(areaName)}
                                    className="rounded-lg border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                                  >
                                    {pendingManagementActions[mergeKey] ? "Saving..." : "Merge"}
                                  </button>
                                  {mergeCanonicalArea === areaName ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setMergeCanonicalArea("");
                                        setMergeSourceArea("");
                                      }}
                                      className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                                    >
                                      Cancel
                                    </button>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <datalist id="admin-area-canonical-options">
          {canonicalAreaOptions.map((option) => (
            <option key={option} value={option} />
          ))}
        </datalist>
        <div className="border-t border-slate-200 px-5 py-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-slate-900">Unmapped Area Review</h3>
              <p className="mt-1 text-sm text-slate-500">
                Review raw areas seen in live submissions that do not match a canonical area or alias.
              </p>
            </div>
            <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
              {unmappedAreas.length} pending
            </span>
          </div>
          <div className="mt-4 overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Raw Area</th>
                  <th className="px-4 py-3 font-semibold">Seen</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <th className="px-4 py-3 font-semibold">Map To</th>
                  <th className="px-4 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
                {!loading && unmappedAreas.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-slate-500">
                      No unmapped areas pending review.
                    </td>
                  </tr>
                ) : null}
                {unmappedAreas.map((review) => {
                  const reviewId = String(review.ReviewID || "").trim();
                  const mapKey = `map-review:${reviewId}`;
                  const createKey = `create-review-area:${reviewId}`;
                  const resolveKey = `resolve-review:${reviewId}`;
                  return (
                    <tr key={reviewId}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-slate-900">{review.RawArea || "-"}</p>
                        <p className="text-xs text-slate-500">ID: {reviewId || "-"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{review.Occurrences || 0}x</p>
                        <p className="text-xs text-slate-500">{formatDateTime(review.LastSeenAt)}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p>{review.SourceType || "-"}</p>
                        <p className="text-xs text-slate-500">{review.SourceRef || "-"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <input
                          list="admin-area-canonical-options"
                          value={reviewTargetAreas[reviewId] ?? ""}
                          onChange={(event) =>
                            setReviewTargetAreas((current) => ({
                              ...current,
                              [reviewId]: event.target.value,
                            }))
                          }
                          placeholder="Select canonical area"
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-slate-500"
                        />
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            disabled={
                              !String(reviewTargetAreas[reviewId] || "").trim() ||
                              Boolean(pendingManagementActions[mapKey])
                            }
                            onClick={() => void handleMapUnmappedArea(review)}
                            className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                          >
                            {pendingManagementActions[mapKey] ? "Saving..." : "Map"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(pendingManagementActions[createKey])}
                            onClick={() => void handleCreateAreaFromUnmapped(review)}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                          >
                            {pendingManagementActions[createKey] ? "Saving..." : "Create Area"}
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(pendingManagementActions[resolveKey])}
                            onClick={() => void handleResolveUnmappedArea(review)}
                            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                          >
                            {pendingManagementActions[resolveKey] ? "Saving..." : "Mark Resolved"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </AccordionSection>

      <AccordionSection
        sectionKey="reportedIssues"
        title="Reported Issues"
        description="Problems reported by logged-in users and providers."
        count={issueReports.length}
        isOpen={openSections.reportedIssues}
        onToggle={toggleSection}
      >
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">IssueID</th>
                <th className="px-4 py-3 font-semibold">ReporterRole</th>
                <th className="px-4 py-3 font-semibold">ReporterPhone</th>
                <th className="px-4 py-3 font-semibold">IssueType</th>
                <th className="px-4 py-3 font-semibold">IssuePage</th>
                <th className="px-4 py-3 font-semibold">Description</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
              {!loading && issueReports.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-6 text-center text-slate-500">
                    No issue reports submitted yet.
                  </td>
                </tr>
              ) : null}
              {issueReports.map((item) => {
                const openKey = `${item.IssueID}:open`;
                const progressKey = `${item.IssueID}:in_progress`;
                const resolvedKey = `${item.IssueID}:resolved`;
                const isPending =
                  Boolean(pendingIssueActions[openKey]) ||
                  Boolean(pendingIssueActions[progressKey]) ||
                  Boolean(pendingIssueActions[resolvedKey]);

                return (
                  <tr key={item.IssueID}>
                    <td className="px-4 py-3">{formatDateTime(item.CreatedAt)}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{item.IssueID}</td>
                    <td className="px-4 py-3">{item.ReporterRole || "-"}</td>
                    <td className="px-4 py-3">{item.ReporterPhone || "-"}</td>
                    <td className="px-4 py-3">{item.IssueType || "-"}</td>
                    <td className="px-4 py-3">{item.IssuePage || "-"}</td>
                    <td className="max-w-[320px] px-4 py-3">
                      <p className="line-clamp-3 whitespace-pre-wrap" title={item.Description || ""}>
                        {item.Description || "-"}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getIssueStatusClass(
                          item.Status
                        )}`}
                      >
                        {item.Status || "open"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => void handleIssueStatusUpdate(item.IssueID, "open")}
                          className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                        >
                          {pendingIssueActions[openKey] ? "Updating..." : "Mark Open"}
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => void handleIssueStatusUpdate(item.IssueID, "in_progress")}
                          className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                        >
                          {pendingIssueActions[progressKey] ? "Updating..." : "In Progress"}
                        </button>
                        <button
                          type="button"
                          disabled={isPending}
                          onClick={() => void handleIssueStatusUpdate(item.IssueID, "resolved")}
                          className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                        >
                          {pendingIssueActions[resolvedKey] ? "Updating..." : "Mark Resolved"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </AccordionSection>

      <AccordionSection
        sectionKey="chatMonitoring"
        title="Chat Monitoring"
        description="Inspect chat threads in read-only mode and apply moderation status updates."
        count={chatThreads.length}
        isOpen={openSections.chatMonitoring}
        onToggle={toggleSection}
        headerAction={
          <button
            type="button"
            onClick={() => void fetchChatThreads()}
            className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            {chatLoading ? "Refreshing..." : "Refresh"}
          </button>
        }
      >
        <div className="grid gap-5 p-5 xl:grid-cols-[1.15fr,0.85fr]">
          <div className="overflow-x-auto rounded-2xl border border-slate-200">
            <table className="min-w-full text-left">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">ThreadID</th>
                  <th className="px-4 py-3 font-semibold">Kaam</th>
                  <th className="px-4 py-3 font-semibold">User</th>
                  <th className="px-4 py-3 font-semibold">Provider</th>
                  <th className="px-4 py-3 font-semibold">Last Message</th>
                  <th className="px-4 py-3 font-semibold">Last Time</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold text-right">Open</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
                {!chatLoading && chatThreads.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                      No chat threads found.
                    </td>
                  </tr>
                ) : null}
                {chatThreads.map((thread) => (
                  <tr
                    key={thread.ThreadID}
                    className={selectedChatThread?.ThreadID === thread.ThreadID ? "bg-sky-50/60" : ""}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">{thread.ThreadID}</td>
                    <td className="px-4 py-3">{getTaskDisplayLabel(thread, thread.TaskID)}</td>
                    <td className="px-4 py-3">{thread.UserPhoneMasked || "-"}</td>
                    <td className="px-4 py-3">{thread.ProviderName || thread.ProviderID || "-"}</td>
                    <td className="max-w-[220px] truncate px-4 py-3" title={thread.LastMessagePreview || ""}>
                      {thread.LastMessagePreview || "-"}
                    </td>
                    <td className="px-4 py-3">{formatDateTime(thread.LastMessageAt || "")}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                        {thread.ThreadStatus || "active"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => void fetchChatThreadDetail(thread.ThreadID)}
                        className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Open
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            {!selectedChatThread ? (
              <p className="text-sm text-slate-500">
                Open a thread to inspect the full conversation and apply moderation status changes.
              </p>
            ) : chatDetailLoading ? (
              <p className="text-sm text-slate-500">Loading thread detail...</p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2 text-sm text-slate-700">
                  <p><span className="font-semibold text-slate-900">ThreadID:</span> {selectedChatThread.ThreadID}</p>
                  <p><span className="font-semibold text-slate-900">Kaam:</span> {getTaskDisplayLabel(selectedChatThread, selectedChatThread.TaskID)}</p>
                  <p><span className="font-semibold text-slate-900">User:</span> {selectedChatThread.UserPhoneMasked || "-"}</p>
                  <p><span className="font-semibold text-slate-900">Provider:</span> {selectedChatThread.ProviderName || selectedChatThread.ProviderID || "-"}</p>
                  <p><span className="font-semibold text-slate-900">Status:</span> {selectedChatThread.ThreadStatus || "active"}</p>
                  <p><span className="font-semibold text-slate-900">Moderation Note:</span> {selectedChatThread.ModerationReason || "-"}</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {(["active", "flagged", "muted", "locked", "closed"] as const).map((statusOption) => {
                    const actionKey = `${statusOption}:${selectedChatThread.ThreadID}`;
                    return (
                      <button
                        key={statusOption}
                        type="button"
                        disabled={chatStatusActionKey === actionKey}
                        onClick={() => void handleChatThreadStatusUpdate(selectedChatThread, statusOption)}
                        className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                      >
                        {chatStatusActionKey === actionKey ? "Saving..." : statusOption}
                      </button>
                    );
                  })}
                </div>

                <div className="max-h-[420px] space-y-3 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  {selectedChatMessages.length === 0 ? (
                    <p className="text-sm text-slate-500">No messages in this thread.</p>
                  ) : (
                    selectedChatMessages.map((message) => (
                      <div key={message.MessageID} className="rounded-xl border border-slate-200 bg-white p-3 text-sm">
                        <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                          <span className="font-semibold uppercase tracking-wide text-slate-700">
                            {message.SenderType || "-"}
                          </span>
                          <span>{formatDateTime(message.CreatedAt)}</span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap text-slate-800">{message.MessageText || "-"}</p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </AccordionSection>

      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Notification Health</h2>
          <p className="mt-1 text-sm text-slate-500">
            Monitor recent WhatsApp notification delivery attempts from task creation.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Recent Attempts</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">{notificationHealth.total}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Accepted</p>
            <p className="mt-2 text-3xl font-bold text-emerald-700">
              {notificationHealth.accepted}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Failed</p>
            <p className="mt-2 text-3xl font-bold text-amber-700">{notificationHealth.failed}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Errors</p>
            <p className="mt-2 text-3xl font-bold text-red-700">{notificationHealth.error}</p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Selected Task Summary</p>
            {selectedTaskNotificationSummary ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">Kaam</p>
                  <p>
                    {getTaskDisplayLabel(
                      requestsByTaskId.get(String(selectedTaskNotificationSummary.taskId || "").trim()) || {
                        TaskID: selectedTaskNotificationSummary.taskId || "",
                        DisplayID: selectedTaskNotificationSummary.DisplayID || "",
                      },
                      selectedTaskNotificationSummary.taskId || ""
                    ) || "-"}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">Latest Attempt</p>
                  <p>{formatDateTime(selectedTaskNotificationSummary.latestCreatedAt)}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">Accepted</p>
                  <p>{selectedTaskNotificationSummary.accepted}</p>
                </div>
                <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                  <p className="font-semibold text-slate-900">Failed / Error</p>
                  <p>
                    {selectedTaskNotificationSummary.failed} / {selectedTaskNotificationSummary.error}
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">
                Select a request to inspect notification results for that task.
              </p>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Latest Activity</p>
            <div className="mt-4 space-y-3">
              {notificationLogs.slice(0, 5).map((log) => (
                <div
                  key={log.LogID}
                  className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">
                      {getTaskDisplayLabel(
                        requestsByTaskId.get(String(log.TaskID || "").trim()) || log,
                        log.TaskID || ""
                      ) || "-"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {log.ProviderID || "-"} • {formatDateTime(log.CreatedAt)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getNotificationStatusClass(
                      log.Status
                    )}`}
                  >
                    {log.Status || "-"}
                  </span>
                </div>
              ))}
              {!loading && notificationLogs.length === 0 ? (
                <p className="text-sm text-slate-500">No notification logs available.</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">CreatedAt</th>
                <th className="px-4 py-3 font-semibold">Kaam</th>
                <th className="px-4 py-3 font-semibold">ProviderID</th>
                <th className="px-4 py-3 font-semibold">ProviderPhone</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">StatusCode</th>
                <th className="px-4 py-3 font-semibold">MessageId</th>
                <th className="px-4 py-3 font-semibold">ErrorMessage</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
              {!loading && notificationLogs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                    No notification logs available.
                  </td>
                </tr>
              ) : null}
              {notificationLogs.map((log) => (
                <tr key={log.LogID}>
                  <td className="px-4 py-3">{formatDateTime(log.CreatedAt)}</td>
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {getTaskDisplayLabel(
                      requestsByTaskId.get(String(log.TaskID || "").trim()) || log,
                      log.TaskID || ""
                    ) || "-"}
                  </td>
                  <td className="px-4 py-3">{log.ProviderID || "-"}</td>
                  <td className="px-4 py-3">{log.ProviderPhone || "-"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getNotificationStatusClass(
                        log.Status
                      )}`}
                    >
                      {log.Status || "-"}
                    </span>
                  </td>
                  <td className="px-4 py-3">{log.StatusCode || "-"}</td>
                  <td className="max-w-[220px] truncate px-4 py-3" title={log.MessageId || ""}>
                    {log.MessageId || "-"}
                  </td>
                  <td className="max-w-[320px] truncate px-4 py-3" title={log.ErrorMessage || ""}>
                    {log.ErrorMessage || "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">Customer Requests Monitor</h2>
          <p className="mt-1 text-sm text-slate-500">
            Track incoming requests, provider responses, reminders, and manual assignment.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Urgent Requests Open</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {requestMetrics.urgentRequestsOpen}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Priority Requests Open</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {requestMetrics.priorityRequestsOpen}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Overdue Requests</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {requestMetrics.overdueRequests}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Requests Needing Attention</p>
            <p className="mt-2 text-3xl font-bold text-slate-900">
              {requestMetrics.needsAttentionCount}
            </p>
          </div>
        </div>

        {selectedRequest ? (
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-slate-500">Request Details</p>
                <h3 className="mt-1 text-lg font-semibold text-slate-900">
                  {getTaskDisplayLabel(selectedRequest, selectedRequest.TaskID)}
                </h3>
                <p className="mt-1 text-sm text-slate-600">{selectedRequest.Details || "-"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href="/admin/chats"
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Open Chat
                </a>
                {(selectedRequest.Status === "RESPONDED" || selectedRequest.Status === "ASSIGNED") ? (
                  <button
                    type="button"
                    disabled={Boolean(pendingManagementActions[`close:${selectedRequest.TaskID}`])}
                    onClick={() => void handleCloseRequest(selectedRequest.TaskID)}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                  >
                    {pendingManagementActions[`close:${selectedRequest.TaskID}`]
                      ? "Closing..."
                      : "Close Request"}
                  </button>
                ) : null}
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Category</p>
                <p>{selectedRequest.Category || "-"}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Area</p>
                <p>{selectedRequest.Area || "-"}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Status</p>
                <p>{getTaskStatusLabel(selectedRequest.Status)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">User Phone</p>
                <a href={`tel:${selectedRequest.UserPhone}`} className="hover:underline">
                  {selectedRequest.UserPhone || "-"}
                </a>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Priority</p>
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getPriorityBadgeClass(
                    selectedRequest
                  )}`}
                >
                  {selectedRequest.Priority || "FLEXIBLE"}
                </span>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Selected Timeframe</p>
                <p>{selectedRequest.SelectedTimeframe || "-"}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Deadline</p>
                <p>{selectedRequest.Deadline ? formatDateTime(selectedRequest.Deadline) : "-"}</p>
              </div>
              <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <p className="font-semibold text-slate-900">Deadline Status</p>
                <p>{formatDeadlineState(selectedRequest)}</p>
              </div>
            </div>
          </div>
        ) : null}

        {[
          {
            sectionKey: "urgentRequests" as const,
            title: "Urgent Requests",
            description: "Within 2 hours requests. Highest priority queue.",
            items: urgentRequests,
          },
          {
            sectionKey: "priorityRequests" as const,
            title: "Priority Requests",
            description: "Within 6 hours requests that still need handling.",
            items: priorityRequests,
          },
          {
            sectionKey: "sameDayRequests" as const,
            title: "Same Day Requests",
            description: "Today / same day requests ordered by urgency.",
            items: sameDayRequests,
          },
          {
            sectionKey: "flexibleRequests" as const,
            title: "Flexible Requests",
            description: "Tomorrow / schedule later requests with lower urgency.",
            items: flexibleRequests,
          },
        ].map((group) => (
          <AccordionSection
            key={group.sectionKey}
            sectionKey={group.sectionKey}
            title={group.title}
            description={group.description}
            count={group.items.length}
            isOpen={openSections[group.sectionKey]}
            onToggle={toggleSection}
          >
            <div className="overflow-x-auto">
              <table className="min-w-full text-left">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">Kaam</th>
                    <th className="px-4 py-3 font-semibold">Category</th>
                    <th className="px-4 py-3 font-semibold">Area</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Priority</th>
                    <th className="px-4 py-3 font-semibold">Waiting</th>
                    <th className="px-4 py-3 font-semibold">Deadline</th>
                    <th className="px-4 py-3 font-semibold text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
                  {!loading && group.items.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center text-slate-500">
                        No requests in this queue.
                      </td>
                    </tr>
                  ) : null}
                  {group.items.map((request) => (
                    <tr key={request.TaskID} className={getPriorityRowClass(request)}>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {getTaskDisplayLabel(request, request.TaskID)}
                      </td>
                      <td className="px-4 py-3">{request.Category || "-"}</td>
                      <td className="px-4 py-3">{request.Area || "-"}</td>
                      <td className="px-4 py-3">{getTaskStatusLabel(request.Status)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-2">
                          <span
                            className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-semibold ${getPriorityBadgeClass(
                              request
                            )}`}
                          >
                            {request.Priority || "FLEXIBLE"}
                          </span>
                          {request.NeedsAttention ? (
                            <span className="text-xs font-medium text-red-600">Needs attention</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3">{formatMinutes(request.WaitingMinutes)}</td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <p>{formatDeadlineState(request)}</p>
                          <p className="text-xs text-slate-500">
                            {request.Deadline ? formatDateTime(request.Deadline) : "-"}
                          </p>
                        </div>
                      </td>
                      <td className="px-4 py-3">{renderRequestActions(request)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </AccordionSection>
        ))}

      </section>
    </div>
  );
}
