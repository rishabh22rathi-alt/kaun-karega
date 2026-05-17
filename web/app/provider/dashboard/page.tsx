"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import InAppToastStack, { type InAppToast } from "@/components/InAppToastStack";
import ProviderDashboardCoachmark from "@/components/ProviderDashboardCoachmark";
import ProviderAliasSubmitter from "@/components/ProviderAliasSubmitter";
import ProviderNotificationPreferencesCard from "@/components/ProviderNotificationPreferencesCard";
import ProviderPledgeModal from "@/components/ProviderPledgeModal";
import { PROVIDER_PLEDGE_VERSION } from "@/lib/disclaimer";
import { getAuthSession } from "@/lib/auth";
import { useSessionGuard } from "@/lib/useSessionGuard";
import { getTaskDisplayLabel } from "@/lib/taskDisplay";
import { isProviderVerifiedBadge } from "@/lib/providerPresentation";
import {
  fetchProviderDashboardProfile,
  readCachedProviderProfile,
  type DashboardMetricsRange,
} from "@/lib/providerDashboardProfile";


type ProviderMetricSummary = {
  TotalRequestsInMyCategories?: number;
  TotalRequestsMatchedToMe?: number;
  TotalRequestsRespondedByMe?: number;
  TotalRequestsAcceptedByMe?: number;
  TotalRequestsCompletedByMe?: number;
  ResponseRate?: number;
  AcceptanceRate?: number;
};

type AreaDemandRow = {
  AreaName: string;
  RequestCount: number;
  IsSelectedByProvider?: boolean;
};

type CategoryDemandRow = {
  CategoryName: string;
  RequestCount: number;
};

type RecentMatchedRequest = {
  TaskID: string;
  DisplayID?: string;
  Category: string;
  Area: string;
  Details?: string;
  CreatedAt?: string;
  Accepted?: boolean;
  Responded?: boolean;
  ThreadID?: string;
};

type ProviderThreadRow = {
  ThreadID: string;
  TaskID: string;
  UnreadProviderCount: number;
  LastMessageAt?: string;
  UpdatedAt?: string;
  CreatedAt?: string;
};

type ProviderThreadSummaryByTaskId = Record<
  string,
  {
    unreadProviderCount: number;
    lastMessageAt: string;
    threadId: string;
  }
>;

type ProviderAnalytics = {
  Summary?: {
    ProviderID?: string;
    Categories?: string[];
    Areas?: string[];
  };
  Metrics?: ProviderMetricSummary;
  AreaDemand?: AreaDemandRow[];
  SelectedAreaDemand?: AreaDemandRow[];
  CategoryDemandByRange?: Record<string, CategoryDemandRow[]>;
  RecentMatchedRequests?: RecentMatchedRequest[];
};

type ProviderCoverageArea = {
  Area: string;
  Status?: string;
};

type ProviderPendingAreaRequest = {
  RequestedArea: string;
  Status?: string;
  LastSeenAt?: string;
};

type ProviderResolvedAreaRequest = {
  RequestedArea: string;
  ResolvedCanonicalArea: string;
  CoverageActive?: boolean;
  Status?: string;
  ResolvedAt?: string;
};

type ProviderAreaCoverage = {
  ActiveApprovedAreas?: ProviderCoverageArea[];
  PendingAreaRequests?: ProviderPendingAreaRequest[];
  ResolvedOutcomes?: ProviderResolvedAreaRequest[];
};

type ProviderProfile = {
  ProviderID: string;
  ProviderName: string;
  Phone: string;
  Verified: string;
  OtpVerified?: string;
  OtpVerifiedAt?: string;
  LastLoginAt?: string;
  PendingApproval?: string;
  Status?: string;
  // True when the provider has zero provider_services rows. Set by the
  // dashboard-profile API after admin removes the provider's last
  // category. The dashboard renders a dedicated re-registration warning
  // + CTA instead of the generic "Pending Admin Approval" badge.
  needsServiceReRegistration?: boolean;
  Services?: {
    Category: string;
    Status?: "approved" | "pending" | "rejected" | "inactive";
  }[];
  Areas?: { Area: string }[];
  AreaCoverage?: ProviderAreaCoverage;
  RejectedCategoryRequests?: {
    RequestedCategory: string;
    Reason?: string;
    ActionAt?: string;
  }[];
  Analytics?: ProviderAnalytics;
};

type CreateThreadResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  created?: boolean;
  ThreadID?: string;
  threadId?: string;
  thread?: {
    ThreadID?: string;
    threadId?: string;
  };
};


function normalizePhone10(phoneRaw: string): string {
  const digits = String(phoneRaw || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

function maskPhoneForDebug(phone10: string): string {
  if (!phone10) return "-";
  if (phone10.length < 4) return "****";
  return "******" + phone10.slice(-4);
}

function formatDateTime(value: string) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("en-IN");
}

function normalizeProviderThread(item: Record<string, unknown>): ProviderThreadRow {
  return {
    ThreadID: String(item.ThreadID ?? item.threadId ?? "") || "",
    TaskID: String(item.TaskID ?? item.taskId ?? "") || "",
    UnreadProviderCount:
      Number(item.UnreadProviderCount ?? item.unreadProviderCount ?? item.UnreadProvider ?? 0) || 0,
    LastMessageAt: String(item.LastMessageAt ?? item.lastMessageAt ?? "") || "",
    UpdatedAt: String(item.UpdatedAt ?? item.updatedAt ?? "") || "",
    CreatedAt: String(item.CreatedAt ?? item.createdAt ?? "") || "",
  };
}

function summarizeProviderThreads(threads: ProviderThreadRow[]): ProviderThreadSummaryByTaskId {
  return threads.reduce<ProviderThreadSummaryByTaskId>((acc, thread) => {
    const taskId = String(thread.TaskID || "").trim();
    if (!taskId) return acc;

    const current = acc[taskId] || { unreadProviderCount: 0, lastMessageAt: "", threadId: "" };
    const candidateTime = String(thread.LastMessageAt || thread.UpdatedAt || thread.CreatedAt || "").trim();
    const currentTime = String(current.lastMessageAt || "").trim();
    const candidateIsNewer = Date.parse(candidateTime || "") > Date.parse(currentTime || "");
    const candidateThreadId = String(thread.ThreadID || "").trim();

    acc[taskId] = {
      unreadProviderCount: current.unreadProviderCount + (Number(thread.UnreadProviderCount) || 0),
      lastMessageAt: candidateIsNewer ? candidateTime : currentTime,
      threadId:
        candidateIsNewer && candidateThreadId
          ? candidateThreadId
          : current.threadId || candidateThreadId,
    };

    return acc;
  }, {});
}

function extractThreadIdFromCreateThreadResponse(data: CreateThreadResponse | null): string {
  return String(
    data?.thread?.ThreadID ||
      data?.thread?.threadId ||
      data?.ThreadID ||
      data?.threadId ||
      ""
  ).trim();
}

function getDemandLevel(count: number, maxCount: number) {
  if (!count || maxCount <= 0) return "Low";
  if (count >= Math.max(5, Math.ceil(maxCount * 0.66))) return "High";
  if (count >= Math.max(2, Math.ceil(maxCount * 0.33))) return "Medium";
  return "Low";
}

function getDemandBadgeClass(level: string) {
  if (level === "High") return "border-orange-200 bg-orange-50 text-orange-700";
  if (level === "Medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

type DemandRangeKey = "today" | "last7Days" | "last30Days" | "last365Days";

const CATEGORY_DEMAND_RANGE_OPTIONS: {
  key: DemandRangeKey;
  label: string;
  labelHindi: string;
}[] = [
  { key: "today", label: "Today", labelHindi: "आज" },
  { key: "last7Days", label: "Last 7 Days", labelHindi: "पिछले 7 दिन" },
  { key: "last30Days", label: "Last 30 Days", labelHindi: "पिछले 30 दिन" },
  { key: "last365Days", label: "Last 365 Days", labelHindi: "पिछले 365 दिन" },
];

function getDemandRangeLabels(rangeKey: DemandRangeKey) {
  return (
    CATEGORY_DEMAND_RANGE_OPTIONS.find((option) => option.key === rangeKey) || {
      key: "today" as const,
      label: "Today",
      labelHindi: "आज",
    }
  );
}

// Time-range filter for the 5 metric tiles. "all" is the default and
// preserves the all-time numbers the dashboard has always shown. Keys mirror
// the API contract on /api/provider/dashboard-profile?range=…
const METRICS_RANGE_OPTIONS: { key: DashboardMetricsRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 Days" },
  { key: "30d", label: "30 Days" },
  { key: "6m", label: "6 Months" },
  { key: "1y", label: "1 Year" },
  { key: "all", label: "All" },
];

function buildCategoryInviteMessage(
  categoryName: string,
  requestCount: number,
  rangeKey: DemandRangeKey,
  joinLink: string
) {
  const range = getDemandRangeLabels(rangeKey);
  return `Hello,
There have been ${requestCount} customer requests for ${categoryName} on Kaun Karega in ${range.label}.
If you or someone you know provides this service, join Kaun Karega and start responding to customer requests.

Join here:
${joinLink}

नमस्ते,
Kaun Karega पर ${range.labelHindi} में ${categoryName} के लिए ${requestCount} ग्राहक रिक्वेस्ट आई हैं।
यदि आप या आपका कोई परिचित यह सेवा देता है, तो Kaun Karega से जुड़ें और ग्राहकों की रिक्वेस्ट पर काम प्राप्त करें।

जुड़ने के लिए:
${joinLink}`;
}

function ProviderDashboardInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const alreadyRegisteredNotice = searchParams.get("alreadyRegistered") === "true";
  // Single-active-session guard. Pings /api/auth/whoami on mount and on
  // tab focus; if a newer device has invalidated this session, clears
  // UI hint cookies and routes to /login?next=/provider/dashboard.
  useSessionGuard({ redirectTo: "/login?next=/provider/dashboard" });
  const [phone, setPhone] = useState("");
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [apiError, setApiError] = useState("");
  const [apiDebug, setApiDebug] = useState<unknown>(null);
  const [debugPhone, setDebugPhone] = useState("");
  const [categoryDemandRange, setCategoryDemandRange] = useState<DemandRangeKey>("today");
  const [metricsRange, setMetricsRange] = useState<DashboardMetricsRange>("all");
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [shareFeedback, setShareFeedback] = useState("");
  const [openingChatTaskId, setOpeningChatTaskId] = useState("");
  const [chatErrorByTaskId, setChatErrorByTaskId] = useState<Record<string, string>>({});
  // Provider Responsibility Pledge — Phase C. Same per-page pattern as
  // /provider/job-requests and /provider/my-jobs. Local state only,
  // no shared hook, no localStorage.
  const [pledgeOpen, setPledgeOpen] = useState(false);
  const [pledgeAccepting, setPledgeAccepting] = useState(false);
  const [pledgeAcceptError, setPledgeAcceptError] = useState<string | null>(null);
  const pendingChatRef = useRef<(() => Promise<void>) | null>(null);
  const [providerThreadSummaryByTaskId, setProviderThreadSummaryByTaskId] =
    useState<ProviderThreadSummaryByTaskId>({});
  const [toasts, setToasts] = useState<InAppToast[]>([]);
  const previousProviderThreadSnapshotRef = useRef<ProviderThreadSummaryByTaskId | null>(null);

  const enqueueToast = (title: string, message: string, id: string) => {
    setToasts((current) => {
      if (current.some((toast) => toast.id === id)) return current;
      return [...current, { id, title, message }].slice(-4);
    });

    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5000);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const session = getAuthSession();
    const cookieNames = document.cookie
      .split(";")
      .map((entry) => entry.trim().split("=")[0])
      .filter(Boolean);
    const phone10 = normalizePhone10(String(session?.phone || ""));

    console.log("[provider/dashboard] auth source debug", {
      session: session
        ? {
            phone: String(session.phone || ""),
            verified: session.verified,
            createdAt: session.createdAt,
          }
        : null,
      cookieNames,
      sessionStorageProviderAuthKeys: [],
      usesLocalStorageForProviderAuthFallback: false,
      usesSessionStorageForProviderAuthFallback: false,
      rawProviderPhone: String(session?.phone || ""),
      normalizedProviderPhone: phone10,
    });

    if (phone10) {
      setPhone(phone10);
      setDebugPhone(maskPhoneForDebug(phone10));
    } else {
      setError("Provider session missing. Please log in again.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!phone) return;

    let ignore = false;

    // Warm-cache hydration: if a cached profile exists for THIS phone, render
    // it instantly so the dashboard does not block on the network round-trip.
    // The background refresh below will overwrite once fresh data arrives.
    // Cached snapshot is always all-time (Sidebar's contract), so only honor
    // it when we're on the default range.
    const cached = metricsRange === "all" ? readCachedProviderProfile(phone) : null;
    if (cached) {
      setProfile(cached as ProviderProfile);
      setLoading(false);
    }

    const load = async () => {
      const isFirstFullLoad = !profile && !cached;
      if (isFirstFullLoad) setLoading(true);
      // Tile-only loading state for range switches (initial full load owns
      // the page-level `loading` flag instead).
      if (!isFirstFullLoad) setMetricsLoading(true);
      setError("");
      setApiError("");
      setApiDebug(null);
      try {
        console.log("[provider/dashboard] api request", {
          endpoint: "/api/provider/dashboard-profile",
          payload: null,
          phoneFromSession: phone,
          warmCacheUsed: Boolean(cached),
          metricsRange,
        });
        // Shared helper: de-dupes the in-flight call with the Sidebar's own
        // fetch, persists to localStorage (only on default range), and
        // dispatches PROVIDER_PROFILE_UPDATED_EVENT.
        const profileData = await fetchProviderDashboardProfile(metricsRange);
        if (!profileData) {
          throw new Error("Invalid JSON from provider profile API.");
        }
        if (!profileData.ok) {
          const code = profileData.error || "UNKNOWN_ERROR";
          setApiError(code);
          setApiDebug(profileData.debug ?? null);
          setError(code);
          setProfile(null);
          return;
        }
        if (!profileData.provider) {
          throw new Error("Provider profile API returned ok:true without provider.");
        }

        if (ignore) return;
        setProfile(profileData.provider as ProviderProfile);
      } catch (err) {
        if (!ignore && !cached) {
          setError(err instanceof Error ? err.message : "Unable to load provider dashboard.");
        }
      } finally {
        if (!ignore) {
          setLoading(false);
          setMetricsLoading(false);
        }
      }
    };

    void load();
    return () => {
      ignore = true;
    };
    // `profile` is intentionally omitted — including it would re-fire on
    // every state set inside `load`, causing an infinite loop. The first-
    // load detection inside `load` reads the latest `profile` via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone, metricsRange]);

  useEffect(() => {
    if (!phone) return;

    let ignore = false;

    const pollProviderThreads = async (showAlerts: boolean) => {
      try {
        const res = await fetch("/api/kk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "chat_get_threads",
            ActorType: "provider",
            loggedInProviderPhone: phone,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Failed to load provider chat alerts");
        }

        const normalizedThreads = Array.isArray(data?.threads)
          ? data.threads.map((item: Record<string, unknown>) => normalizeProviderThread(item))
          : [];
        const nextSummary = summarizeProviderThreads(normalizedThreads);

        if (!ignore) {
          setProviderThreadSummaryByTaskId(nextSummary);
        }

        if (showAlerts && previousProviderThreadSnapshotRef.current) {
          for (const [taskId, summary] of Object.entries(nextSummary)) {
            const previousSummary = previousProviderThreadSnapshotRef.current[taskId];
            if (!previousSummary) continue;
            if (summary.unreadProviderCount > previousSummary.unreadProviderCount && summary.lastMessageAt) {
              enqueueToast(
                "New message from customer",
                `${recentRequestDisplayLabelByTaskId[taskId] || getTaskDisplayLabel({ TaskID: taskId }, taskId)} has ${summary.unreadProviderCount} unread customer message${summary.unreadProviderCount === 1 ? "" : "s"}.`,
                `provider-message:${taskId}:${summary.unreadProviderCount}:${summary.lastMessageAt}`
              );
            }
          }
        }

        previousProviderThreadSnapshotRef.current = nextSummary;
      } catch {
        // Silent polling failure for MVP alerts.
      }
    };

    void pollProviderThreads(false);

    const intervalId = window.setInterval(() => {
      void pollProviderThreads(true);
    }, 18000);

    return () => {
      ignore = true;
      window.clearInterval(intervalId);
    };
  }, [phone]);

  const verified = useMemo(
    () => isProviderVerifiedBadge(profile ?? {}),
    [profile]
  );
  const pendingApproval = useMemo(
    () => String(profile?.PendingApproval || "").trim().toLowerCase() === "yes",
    [profile]
  );
  const needsServiceReRegistration = useMemo(
    () => Boolean(profile?.needsServiceReRegistration),
    [profile]
  );
  const services = useMemo(
    () => (Array.isArray(profile?.Services) ? profile?.Services : []),
    [profile]
  );
  const areas = useMemo(() => (Array.isArray(profile?.Areas) ? profile?.Areas : []), [profile]);
  const analytics = useMemo<ProviderAnalytics>(
    () => (profile?.Analytics && typeof profile.Analytics === "object" ? profile.Analytics : {}),
    [profile]
  );
  const areaCoverage = useMemo<ProviderAreaCoverage>(
    () =>
      profile?.AreaCoverage && typeof profile.AreaCoverage === "object"
        ? profile.AreaCoverage
        : {},
    [profile]
  );
  const metrics = useMemo<ProviderMetricSummary>(
    () => (analytics.Metrics && typeof analytics.Metrics === "object" ? analytics.Metrics : {}),
    [analytics]
  );
  const areaDemand = useMemo(
    () => (Array.isArray(analytics.AreaDemand) ? analytics.AreaDemand : []),
    [analytics]
  );
  const selectedAreaDemand = useMemo(
    () => (Array.isArray(analytics.SelectedAreaDemand) ? analytics.SelectedAreaDemand : []),
    [analytics]
  );
  const categoryDemandByRange = useMemo<Record<string, CategoryDemandRow[]>>(
    () =>
      analytics.CategoryDemandByRange && typeof analytics.CategoryDemandByRange === "object"
        ? analytics.CategoryDemandByRange
        : {},
    [analytics]
  );
  const recentMatchedRequests = useMemo(
    () =>
      (Array.isArray(analytics.RecentMatchedRequests) ? analytics.RecentMatchedRequests : []).slice(
        0,
        6
      ),
    [analytics]
  );
  const openRequestsWaitingCount = useMemo(
    () =>
      (Array.isArray(analytics.RecentMatchedRequests)
        ? analytics.RecentMatchedRequests
        : []
      ).filter((req) => !req.Accepted && !req.Responded).length,
    [analytics]
  );
  const recentRequestDisplayLabelByTaskId = useMemo(() => {
    const next: Record<string, string> = {};
    for (const request of recentMatchedRequests) {
      const taskId = String(request.TaskID || "").trim();
      if (!taskId) continue;
      next[taskId] = getTaskDisplayLabel(request, taskId);
    }
    return next;
  }, [recentMatchedRequests]);

  const handleOpenChat = async (request: RecentMatchedRequest) => {
    const taskId = String(request.TaskID || "").trim();
    const existingThreadId = String(request.ThreadID || "").trim();
    const requestKey = taskId || `missing-task-${request.CreatedAt || request.Category || "unknown"}`;

    console.log("[provider/dashboard] matched request item shape", {
      request,
      taskId,
      threadId: existingThreadId,
      keys: Object.keys(request || {}),
    });

    if (!taskId) {
      console.log("[provider/dashboard] open chat blocked", {
        reason: "missing_task_id",
        request,
      });
      setChatErrorByTaskId((current) => ({
        ...current,
        [requestKey]: "Chat unavailable: missing task ID for this request.",
      }));
      return;
    }

    if (!phone) {
      setChatErrorByTaskId((current) => ({
        ...current,
        [requestKey]: "Chat unavailable: provider session missing.",
      }));
      return;
    }

    await openThreadAndNavigate(taskId, requestKey, phone);
  };

  // Inner closure — split out so the silent 403 PLEDGE_REQUIRED path can
  // stash this exact call (with its captured args) into pendingChatRef
  // and re-run it verbatim after the provider accepts the pledge. Same
  // pattern as /provider/job-requests and /provider/my-jobs.
  const openThreadAndNavigate = async (
    taskId: string,
    requestKey: string,
    providerPhone: string
  ): Promise<void> => {
    setOpeningChatTaskId(taskId);
    setChatErrorByTaskId((current) => ({
      ...current,
      [requestKey]: "",
      [taskId]: "",
    }));

    try {
      const res = await fetch("/api/kk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "chat_create_or_get_thread",
          ActorType: "provider",
          TaskID: taskId,
          loggedInProviderPhone: providerPhone,
        }),
      });
      const data = (await res
        .json()
        .catch(() => null)) as CreateThreadResponse | null;

      // Silent provider-pledge gate. Phase B's /api/kk gate returns 403
      // PLEDGE_REQUIRED for legacy/imported providers; show the modal
      // with no scary toast and queue the retry.
      if (res.status === 403 && data?.error === "PLEDGE_REQUIRED") {
        pendingChatRef.current = () =>
          openThreadAndNavigate(taskId, requestKey, providerPhone);
        setPledgeAcceptError(null);
        setPledgeOpen(true);
        setOpeningChatTaskId("");
        return;
      }

      const threadId = extractThreadIdFromCreateThreadResponse(data);
      const finalHref = threadId ? `/chat/thread/${encodeURIComponent(threadId)}` : "";

      console.log("[provider/dashboard] open chat raw response", {
        status: res.status,
        ok: res.ok,
        data,
      });

      console.log("[provider/dashboard] open chat selection", {
        taskId,
        extractedThreadId: threadId,
        created: Boolean(data?.created),
        finalHref,
      });

      if (!res.ok || !data?.ok || !threadId || !finalHref) {
        throw new Error(data?.error || data?.message || "Unable to open chat.");
      }

      router.push(finalHref);
    } catch (err) {
      setChatErrorByTaskId((current) => ({
        ...current,
        [taskId]: err instanceof Error ? err.message : "Unable to open chat.",
      }));
      setOpeningChatTaskId("");
    }
  };

  const acceptProviderPledge = async () => {
    setPledgeAccepting(true);
    setPledgeAcceptError(null);
    try {
      const res = await fetch("/api/provider/pledge", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: PROVIDER_PLEDGE_VERSION }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setPledgeAcceptError("Could not save right now. Please try again.");
        return;
      }
      setPledgeOpen(false);
      const queued = pendingChatRef.current;
      pendingChatRef.current = null;
      if (queued) {
        void queued();
      }
    } catch {
      setPledgeAcceptError("Could not save right now. Please try again.");
    } finally {
      setPledgeAccepting(false);
    }
  };

  const dismissProviderPledge = () => {
    pendingChatRef.current = null;
    setPledgeOpen(false);
    setPledgeAcceptError(null);
  };
  const categoryDemand = useMemo(
    () =>
      Array.isArray(categoryDemandByRange[categoryDemandRange])
        ? categoryDemandByRange[categoryDemandRange]
        : [],
    [categoryDemandByRange, categoryDemandRange]
  );

  const activeCoverageAreas = useMemo(
    () =>
      Array.isArray(areaCoverage.ActiveApprovedAreas) && areaCoverage.ActiveApprovedAreas.length
        ? areaCoverage.ActiveApprovedAreas
        : areas.map((area) => ({ Area: area.Area, Status: "active" })),
    [areaCoverage, areas]
  );
  const pendingAreaRequests = useMemo(
    () => (Array.isArray(areaCoverage.PendingAreaRequests) ? areaCoverage.PendingAreaRequests : []),
    [areaCoverage]
  );
  const resolvedAreaRequests = useMemo(
    () => (Array.isArray(areaCoverage.ResolvedOutcomes) ? areaCoverage.ResolvedOutcomes : []),
    [areaCoverage]
  );
  const approvedServices = useMemo(
    () => services.filter((s) => (s.Status ?? "approved") === "approved"),
    [services]
  );
  const pendingServiceCategoryRequests = useMemo(
    () => services.filter((s) => s.Status === "pending"),
    [services]
  );
  const rejectedCategoryRequests = useMemo(
    () =>
      Array.isArray(profile?.RejectedCategoryRequests)
        ? profile?.RejectedCategoryRequests ?? []
        : [],
    [profile]
  );
  // The re-registration label overrides the generic "Pending Admin
  // Approval" copy so the provider sees the actual reason for the
  // banner (admin removed their last category) instead of a vague
  // pending status.
  const statusLabel = needsServiceReRegistration
    ? "Service category rejected / needs re-registration"
    : verified
      ? "Phone Verified"
      : pendingApproval
        ? "Pending Admin Approval"
        : "Not Verified";
  const maxDemandCount = useMemo(
    () => areaDemand.reduce((max, item) => Math.max(max, Number(item.RequestCount || 0)), 0),
    [areaDemand]
  );
  const selectedMaxDemandCount = useMemo(
    () =>
      selectedAreaDemand.reduce((max, item) => Math.max(max, Number(item.RequestCount || 0)), 0),
    [selectedAreaDemand]
  );
  const highestDemandArea = areaDemand[0]?.AreaName || "";
  const highDemandSelectedAreas = selectedAreaDemand.filter(
    (item) => getDemandLevel(Number(item.RequestCount || 0), selectedMaxDemandCount || maxDemandCount) === "High"
  );
  const responseRate = Number(metrics.ResponseRate || 0);
  const maxCategoryDemandCount = useMemo(
    () => categoryDemand.reduce((max, item) => Math.max(max, Number(item.RequestCount || 0)), 0),
    [categoryDemand]
  );
  const joinLink = useMemo(() => {
    if (typeof window === "undefined") return "/provider/register";
    return new URL("/provider/register", window.location.origin).toString();
  }, []);

  const insightLines = [
    highestDemandArea
      ? `Highest demand in your services is currently in ${highestDemandArea}.`
      : "Demand insights will appear once customer requests start coming in.",
    selectedAreaDemand.length
      ? `Your selected areas currently cover ${highDemandSelectedAreas.length} high-demand zone${
          highDemandSelectedAreas.length === 1 ? "" : "s"
        }.`
      : "Add service areas to compare which zones are generating more requests.",
    `You have responded to ${Number(metrics.TotalRequestsRespondedByMe || 0)} out of ${Number(
      metrics.TotalRequestsMatchedToMe || 0
    )} matched lead${Number(metrics.TotalRequestsMatchedToMe || 0) === 1 ? "" : "s"}.`,
  ];
  const topCityDemandCategory = categoryDemand[0]?.CategoryName || "";
  const highDemandCategoriesCount = categoryDemand.filter(
    (item) => getDemandLevel(Number(item.RequestCount || 0), maxCategoryDemandCount) === "High"
  ).length;

  const matrixInsightLines = [
    topCityDemandCategory
      ? `${topCityDemandCategory} is currently one of the busiest service categories in the city.`
      : "Track live service demand across the city as requests start coming in.",
    categoryDemand.length
      ? `${highDemandCategoriesCount} categorie${highDemandCategoriesCount === 1 ? "s are" : "s are"} currently in the high-demand band for ${getDemandRangeLabels(categoryDemandRange).label.toLowerCase()}.`
      : "No category demand data is available for the selected time range yet.",
  ];

  const handleCopyInvite = async (item: CategoryDemandRow) => {
    const message = buildCategoryInviteMessage(
      item.CategoryName,
      Number(item.RequestCount || 0),
      categoryDemandRange,
      joinLink
    );

    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(message);
      setShareFeedback(`Invite message copied for ${item.CategoryName}.`);
    } catch {
      setShareFeedback("Unable to copy invite message on this device.");
    }
  };

  const handleWhatsAppShare = (item: CategoryDemandRow) => {
    const message = buildCategoryInviteMessage(
      item.CategoryName,
      Number(item.RequestCount || 0),
      categoryDemandRange,
      joinLink
    );
    if (typeof window !== "undefined") {
      window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
    }
  };

  const statsCards = [
    {
      title: "Requests In Your Services",
      value: Number(metrics.TotalRequestsInMyCategories || 0),
      tone: "bg-orange-50 border-orange-200 text-[#003d20]",
      note: "Overall demand in your selected categories",
    },
    {
      title: "Matched To You",
      value: Number(metrics.TotalRequestsMatchedToMe || 0),
      tone: "bg-amber-50 border-amber-200 text-[#003d20]",
      note: "Leads where you were one of the matched providers",
    },
    {
      // Renamed from "Responded By You" → "Chat Opened By You" to honestly
      // reflect what the underlying metric measures: provider tapped Open
      // Chat at least once on the lead. Backed by the same
      // TotalRequestsRespondedByMe value (provider_task_matches rows where
      // match_status ∈ {"responded","accepted"}). Query logic unchanged.
      title: "Chat Opened By You",
      value: Number(metrics.TotalRequestsRespondedByMe || 0),
      tone: "bg-emerald-50 border-emerald-200 text-[#003d20]",
      note: `Chat-open rate ${responseRate}%`,
    },
  ];

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto w-full max-w-6xl rounded-[28px] border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Loading provider dashboard...
        </div>
      </main>
    );
  }

  if (!phone) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-base font-semibold text-slate-900">
            Please login. Invalid or missing provider phone.
          </p>
          <Link
            href="/provider/login"
            className="mt-3 inline-flex rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-sky-600"
          >
            Go to Provider Login
          </Link>
        </div>
      </main>
    );
  }

  if (error || !profile) {
    return (
      <main className="min-h-screen bg-slate-50 px-4 py-8">
        <div className="mx-auto w-full max-w-2xl rounded-[28px] border border-rose-200 bg-rose-50 p-6 shadow-sm">
          <p className="text-sm font-semibold text-rose-700">
            {error || "Unable to load provider dashboard."}
          </p>
          {apiError ? <p className="mt-1 text-xs text-rose-700">Error: {apiError}</p> : null}
          {debugPhone ? (
            <p className="mt-1 text-xs text-rose-700">Request phone: {debugPhone}</p>
          ) : null}
          {process.env.NODE_ENV !== "production" && apiDebug ? (
            <pre className="mt-3 max-h-44 overflow-auto rounded border border-rose-200 bg-rose-100 p-2 text-[10px] leading-relaxed text-rose-900">
              {JSON.stringify(apiDebug, null, 2)}
            </pre>
          ) : null}
          <Link
            href="/provider/register"
            className="mt-4 inline-flex rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700"
          >
            Register as Provider
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#eef6ff_100%)] px-4 py-8">
      <div className="mx-auto w-full max-w-6xl space-y-6">
        {alreadyRegisteredNotice ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
            You are already registered. You can update your details from dashboard.
          </div>
        ) : null}
        <section
          data-provider-tour="profile"
          className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-sm"
        >
          <div className="grid gap-6 px-6 py-7 lg:grid-cols-[minmax(0,1fr)_240px] lg:px-8">
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
                Provider Intelligence Dashboard
              </p>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                  {profile.ProviderName}
                </h1>
                <p className="mt-2 text-sm font-medium text-slate-500">
                  Your provider dashboard is ready.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700">
                  ProviderID: {profile.ProviderID}
                </span>
                <span
                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${
                    verified
                      ? "border-green-200 bg-green-100 text-green-800"
                      : pendingApproval
                        ? "border-amber-200 bg-amber-50 text-amber-700"
                        : "border-slate-200 bg-slate-100 text-slate-700"
                  }`}
                >
                  {statusLabel}
                </span>
              </div>
              {profile.Phone ? (
                <p className="text-sm text-slate-500">Phone: {profile.Phone}</p>
              ) : null}
            </div>
            <div className="flex flex-col lg:items-end">
              <Link
                href="/provider/register?edit=services"
                className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800"
              >
                Edit Services & Areas
              </Link>
            </div>
          </div>
        </section>

        {needsServiceReRegistration && (
          <section
            data-testid="service-reregistration-warning"
            aria-live="polite"
            className="rounded-2xl border border-rose-300 bg-rose-50 px-5 py-4 text-sm text-rose-800 shadow-sm"
          >
            <p className="text-base font-semibold text-rose-900">
              Service category rejected / needs re-registration
            </p>
            <p className="mt-1 text-sm leading-snug text-rose-800">
              Your service category was removed by admin. Please re-register
              your service category to start receiving work again.
            </p>
            <Link
              href="/provider/register?edit=services"
              data-testid="service-reregistration-cta"
              className="mt-3 inline-flex items-center justify-center rounded-xl bg-rose-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-800"
            >
              Register service again
            </Link>
          </section>
        )}

        <section
          aria-label="Open requests waiting"
          data-testid="open-requests-strip"
          data-provider-tour="open-requests"
          className="flex flex-row items-center justify-between gap-3 rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 sm:gap-4 sm:px-5 sm:py-4"
        >
          <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-[#003d20] sm:text-base">
            {openRequestsWaitingCount > 0 ? (
              <>
                Open Requests Waiting{" "}
                <span className="font-bold">· {openRequestsWaitingCount}</span>
              </>
            ) : (
              "No new requests right now — we’ll notify you."
            )}
          </p>
          <Link
            href="/provider/my-jobs"
            className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#003d20] px-4 py-2 text-xs font-bold text-white shadow-sm transition duration-200 hover:bg-[#002a16] hover:shadow-md sm:text-sm"
          >
            View My Jobs
          </Link>
        </section>

        {!verified ? (
          <section className="rounded-[28px] border border-amber-200 bg-amber-50/80 p-5 shadow-sm">
            <p className="text-sm font-semibold text-amber-900">
              {pendingApproval ? "Pending Admin Approval" : "Phone Verification Pending"}
            </p>
            <p className="mt-2 text-sm leading-6 text-amber-800">
              {pendingApproval
                ? "Your dashboard is live, but one or more categories are still under review. You can still monitor demand and refine your service areas."
                : "You can still use demand insights now, but providers who have completed OTP login are ranked above non-verified providers in user-facing lists."}
            </p>
          </section>
        ) : null}

        <section
          aria-labelledby="provider-metrics-heading"
          data-provider-tour="metrics"
          className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"
        >
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 id="provider-metrics-heading" className="text-xl font-semibold text-slate-900">
                Your activity
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Filter the tiles below by time range. The default is all-time.
              </p>
            </div>
            <div
              role="radiogroup"
              aria-label="Metrics time range"
              data-testid="metrics-range-selector"
              className="flex flex-wrap gap-2"
            >
              {METRICS_RANGE_OPTIONS.map((option) => {
                const isSelected = metricsRange === option.key;
                return (
                  <button
                    key={option.key}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    data-testid={`metrics-range-option-${option.key}`}
                    data-selected={isSelected ? "true" : "false"}
                    onClick={() => {
                      if (metricsRange === option.key) return;
                      setMetricsRange(option.key);
                    }}
                    className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                      isSelected
                        ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                        : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div
            className={`mt-5 grid gap-4 transition-opacity sm:grid-cols-3 ${
              metricsLoading ? "opacity-60" : "opacity-100"
            }`}
            aria-busy={metricsLoading}
            data-testid="metrics-tiles"
          >
            {statsCards.map((card) => (
              <div
                key={card.title}
                className={`rounded-[24px] border px-5 py-5 shadow-sm ${card.tone}`}
              >
                <p className="text-sm font-semibold">{card.title}</p>
                <p className="mt-3 text-3xl font-bold">
                  {metricsLoading ? "…" : card.value}
                </p>
                <p className="mt-2 text-xs opacity-80">{card.note}</p>
              </div>
            ))}
          </div>
        </section>

        {/*
          TODO: Provider BI sections removed from MVP dashboard until demand
          intelligence data is normalized and time-scoped.
          Removed UI: My Demand Insights, City Demand by Service Category,
          Area Demand Heat Table, My Selected Areas Performance.
          Backend aggregation (analytics.AreaDemand, SelectedAreaDemand,
          CategoryDemandByRange) is still emitted by
          /api/provider/dashboard-profile and remains untouched. Re-render
          these sections here once case-normalization and month-wise scoping
          ship per the dashboard data-flow audit.
        */}

        <section data-provider-tour="services" className="space-y-6">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Service
                  </h2>
                </div>
                <Link
                  href="/provider/register?edit=services"
                  className="inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                >
                  Edit
                </Link>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                {services.length ? (
                  services.map((service) => (
                    <span
                      key={service.Category}
                      className={
                        service.Status === "pending"
                          ? "rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700"
                          : service.Status === "rejected"
                            ? "rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-xs font-semibold text-rose-700"
                            : service.Status === "inactive"
                              ? "rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-semibold text-gray-600"
                              : "rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                      }
                    >
                      {service.Category}
                      {service.Status === "pending" && " · Under Review"}
                      {service.Status === "rejected" && " · Rejected"}
                      {service.Status === "inactive" && " · Inactive"}
                    </span>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No services added yet.</p>
                )}
              </div>

              {profile?.ProviderID && approvedServices[0]?.Category ? (
                <ProviderAliasSubmitter
                  providerId={profile.ProviderID}
                  canonicalCategory={approvedServices[0].Category}
                />
              ) : null}
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Service Coverage
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Areas are auto-approved. New service categories require admin review.
                  </p>
                </div>
                <Link
                  href="/provider/register?edit=areas"
                  className="inline-flex rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 hover:text-sky-700"
                >
                  Edit
                </Link>
              </div>
              <div className="mt-5 space-y-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Areas Under Your Selected Regions
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    These areas update automatically when admin updates
                    your selected regions.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {activeCoverageAreas.length ? (
                      activeCoverageAreas.map((area) => (
                        <span
                          key={area.Area}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                        >
                          {area.Area}
                        </span>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">No active service areas yet.</p>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                    Active Approved Service Category
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {approvedServices.length ? (
                      approvedServices.map((service) => (
                        <span
                          key={service.Category}
                          className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                        >
                          {service.Category}
                        </span>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">
                        No approved service categories yet.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                    Pending Service Category Requests
                  </p>
                  <div className="mt-3 space-y-2">
                    {pendingServiceCategoryRequests.length ? (
                      pendingServiceCategoryRequests.map((service) => (
                        <div
                          key={service.Category}
                          className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-amber-900">
                            {service.Category}
                          </p>
                          <p className="mt-1 text-xs text-amber-800">
                            Waiting for admin review
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">
                        No pending category requests.
                      </p>
                    )}
                  </div>
                </div>

                {rejectedCategoryRequests.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-rose-700">
                      Rejected Service Category Requests
                    </p>
                    <div className="mt-3 space-y-2">
                      {rejectedCategoryRequests.map((item) => (
                        <div
                          key={`${item.RequestedCategory}:${item.ActionAt || ""}`}
                          className="rounded-2xl border border-rose-200 bg-rose-50/70 px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-rose-900">
                            {item.RequestedCategory}
                          </p>
                          <p className="mt-1 text-xs text-rose-800">
                            Rejected by admin
                            {item.ActionAt
                              ? ` • ${formatDateTime(item.ActionAt)}`
                              : ""}
                            {item.Reason ? ` • Reason: ${item.Reason}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {pendingAreaRequests.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                      Pending Area Requests
                    </p>
                    <div className="mt-3 space-y-2">
                      {pendingAreaRequests.map((item) => (
                        <div
                          key={`${item.RequestedArea}:${item.LastSeenAt || ""}`}
                          className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-3"
                        >
                          <p className="text-sm font-semibold text-amber-900">{item.RequestedArea}</p>
                          <p className="mt-1 text-xs text-amber-800">
                            Waiting for admin review
                            {item.LastSeenAt ? ` • Requested ${formatDateTime(item.LastSeenAt)}` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {resolvedAreaRequests.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                      Resolved Area Outcomes
                    </p>
                    <div className="mt-3 space-y-2">
                      {resolvedAreaRequests.map((item) => {
                        const mapped =
                          String(item.Status || "").trim().toLowerCase() === "mapped";
                        return (
                          <div
                            key={`${item.RequestedArea}:${item.ResolvedCanonicalArea}:${item.ResolvedAt || ""}`}
                            className="rounded-2xl border border-sky-200 bg-sky-50/70 px-4 py-3"
                          >
                            <p className="text-sm font-semibold text-sky-900">
                              {mapped
                                ? `${item.RequestedArea} -> ${item.ResolvedCanonicalArea}`
                                : item.ResolvedCanonicalArea}
                            </p>
                            <p className="mt-1 text-xs text-sky-800">
                              {item.CoverageActive
                                ? "Now active for matching"
                                : "Resolved by admin; active coverage update not visible yet"}
                              {item.ResolvedAt ? ` • Resolved ${formatDateTime(item.ResolvedAt)}` : ""}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

        <ProviderNotificationPreferencesCard />
      </div>
      <InAppToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />
      <ProviderDashboardCoachmark />
      <ProviderPledgeModal
        open={pledgeOpen}
        onAccept={acceptProviderPledge}
        onDismiss={dismissProviderPledge}
        isAccepting={pledgeAccepting}
        acceptError={pledgeAcceptError}
      />
    </main>
  );
}
export default function ProviderDashboardPage() {
  return (
    <Suspense fallback={null}>
      <ProviderDashboardInner />
    </Suspense>
  );
}