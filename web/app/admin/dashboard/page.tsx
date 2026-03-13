"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

type DashboardStats = {
  totalProviders: number;
  verifiedProviders: number;
  pendingAdminApprovals: number;
  pendingCategoryRequests: number;
};

type CategoryApplication = {
  RequestID: string;
  ProviderName: string;
  Phone: string;
  RequestedCategory: string;
  Status: string;
  CreatedAt: string;
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

type ManagedAreaMapping = {
  CanonicalArea: string;
  Active: string;
  Aliases: ManagedAreaAlias[];
  AliasCount: number;
};

type AdminRequest = {
  TaskID: string;
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

type AdminAreaMappingsResponse = {
  ok?: boolean;
  mappings?: ManagedAreaMapping[];
  error?: string;
};

type ActionState = Record<string, boolean>;

type DashboardSectionKey =
  | "pendingCategoryRequests"
  | "providers"
  | "categoriesManagement"
  | "areasManagement"
  | "urgentRequests"
  | "priorityRequests"
  | "sameDayRequests"
  | "flexibleRequests"
  | "needsAttention";

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
  const [requests, setRequests] = useState<AdminRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [feedbackType, setFeedbackType] = useState<"success" | "error" | "">("");
  const [pendingCategoryActions, setPendingCategoryActions] = useState<ActionState>({});
  const [pendingProviderActions, setPendingProviderActions] = useState<ActionState>({});
  const [pendingManagementActions, setPendingManagementActions] = useState<ActionState>({});
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
  const [mergeCanonicalArea, setMergeCanonicalArea] = useState("");
  const [mergeSourceArea, setMergeSourceArea] = useState("");
  const [selectedRequestId, setSelectedRequestId] = useState("");
  const [assigningTaskId, setAssigningTaskId] = useState("");
  const [assignProviderId, setAssignProviderId] = useState("");
  const [openSections, setOpenSections] = useState<Record<DashboardSectionKey, boolean>>({
    pendingCategoryRequests: true,
    providers: false,
    categoriesManagement: false,
    areasManagement: false,
    urgentRequests: true,
    priorityRequests: false,
    sameDayRequests: false,
    flexibleRequests: false,
    needsAttention: true,
  });
  const needsAttentionRef = useRef<HTMLDivElement | null>(null);

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

  const sortRequests = (items: AdminRequest[]) =>
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

  const normalizePhone = (value: string) => String(value || "").replace(/\D/g, "").slice(-10);

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

  const fetchDashboard = async () => {
    setLoading(true);
    setError("");
    try {
      const [dashboardRes, requestsRes, areaMappingsRes] = await Promise.all([
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
        }),
      ]);
      const data = (await dashboardRes.json()) as AdminDashboardResponse;
      const requestsData = (await requestsRes.json()) as AdminRequestsResponse;
      const areaMappingsData = (await areaMappingsRes.json()) as AdminAreaMappingsResponse;
      if (!dashboardRes.ok || !data.ok) {
        throw new Error(data.error || "Failed to load admin dashboard");
      }
      if (!requestsRes.ok || !requestsData.ok) {
        throw new Error(requestsData.error || "Failed to load admin requests");
      }
      if (!areaMappingsRes.ok || !areaMappingsData.ok) {
        throw new Error(areaMappingsData.error || "Failed to load area mappings");
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
      setAreaMappings(
        sortAreaMappings(Array.isArray(areaMappingsData.mappings) ? areaMappingsData.mappings : [])
      );
      setRequests(sortRequests(Array.isArray(requestsData.requests) ? requestsData.requests : []));
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load admin dashboard"
      );
    } finally {
      setLoading(false);
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

  useEffect(() => {
    void fetchDashboard();
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

  const toggleAreaExpanded = (canonicalArea: string) => {
    setExpandedAreas((current) => ({
      ...current,
      [canonicalArea]: !current[canonicalArea],
    }));
  };

  const handleCategoryRequestAction = async (
    request: CategoryApplication,
    action: "approve_category_request" | "reject_category_request"
  ) => {
    const requestId = String(request.RequestID || "").trim();
    if (!requestId) return;

    clearFeedback();
    setPendingCategoryActions((current) => ({ ...current, [requestId]: true }));

    try {
      const payload =
        action === "approve_category_request"
          ? {
              action,
              requestId,
              categoryName: request.RequestedCategory,
            }
          : {
              action,
              requestId,
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

      setCategoryApplications((current) => {
        const nextCategoryApplications = current.filter(
          (item) => String(item.RequestID || "").trim() !== requestId
        );
        recalculateStats(providers, nextCategoryApplications);
        return nextCategoryApplications;
      });
      showFeedback("success", "Action completed successfully");
    } catch {
      showFeedback("error", "Failed to update");
    } finally {
      setPendingCategoryActions((current) => {
        const next = { ...current };
        delete next[requestId];
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
            ? { ...item, Verified: nextVerified }
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
          action: "add_area_alias",
          aliasName,
          canonicalArea,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };

      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Failed to update");
      }

      await fetchAreaMappings();
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
            {providers.map((provider) => (
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
          href={`/admin/chat?taskId=${encodeURIComponent(request.TaskID)}`}
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
    <div className="space-y-6">
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
        description="Approve or reject requests inline."
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
                const isPending = Boolean(pendingCategoryActions[requestId]);

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
                        {isPending ? "Updating..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() =>
                          void handleCategoryRequestAction(item, "reject_category_request")
                        }
                        className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:text-slate-400"
                      >
                        {isPending ? "Updating..." : "Reject"}
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
                  <th className="px-4 py-3 font-semibold">TaskID</th>
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
                      <td className="px-4 py-3 font-medium text-slate-900">{request.TaskID}</td>
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
                                {providers.map((provider) => (
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
        count={providersNeedingAttention.length}
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
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
                const isEditing = editingAreaName === areaName;
                const editKey = `edit-area:${areaName}`;
                const aliasKey = `add-alias:${areaName}`;
                const mergeKey = `merge-area:${areaName}`;
                const isExpanded = Boolean(expandedAreas[areaName]);
                const isActive = String(area.Active || "yes").trim().toLowerCase() === "yes";
                const previewAliases = area.Aliases.slice(0, 3).map((item) => item.AliasName).join(", ");

                return (
                  <>
                    <tr key={areaName}>
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
                      <tr key={`${areaName}-aliases`} className="bg-slate-50/60">
                        <td colSpan={4} className="px-4 py-4">
                          <div className="grid gap-4 lg:grid-cols-3">
                            <div className="rounded-xl border border-slate-200 bg-white p-4">
                              <p className="text-sm font-semibold text-slate-900">Aliases</p>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {area.Aliases.length ? (
                                  area.Aliases.map((alias) => {
                                    const aliasActive =
                                      String(alias.Active || "yes").trim().toLowerCase() === "yes";
                                    return (
                                      <span
                                        key={`${areaName}-${alias.AliasName}`}
                                        className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium ${
                                          aliasActive
                                            ? "border-sky-200 bg-sky-50 text-sky-700"
                                            : "border-slate-200 bg-slate-100 text-slate-700"
                                        }`}
                                      >
                                        {alias.AliasName}
                                      </span>
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
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </AccordionSection>

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
                  {selectedRequest.TaskID}
                </h3>
                <p className="mt-1 text-sm text-slate-600">{selectedRequest.Details || "-"}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/admin/chat?taskId=${encodeURIComponent(selectedRequest.TaskID)}`}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Open Chat
                </a>
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
                <p>{selectedRequest.Status || "-"}</p>
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
                    <th className="px-4 py-3 font-semibold">TaskID</th>
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
                      <td className="px-4 py-3 font-medium text-slate-900">{request.TaskID}</td>
                      <td className="px-4 py-3">{request.Category || "-"}</td>
                      <td className="px-4 py-3">{request.Area || "-"}</td>
                      <td className="px-4 py-3">{request.Status || "-"}</td>
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
