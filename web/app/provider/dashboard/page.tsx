"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import InAppToastStack, { type InAppToast } from "@/components/InAppToastStack";
import { PROVIDER_PROFILE_UPDATED_EVENT } from "@/components/sidebarEvents";
import { getAuthSession } from "@/lib/auth";
import { getTaskDisplayLabel } from "@/lib/taskDisplay";
import { isProviderVerifiedBadge } from "@/lib/providerPresentation";

const MAX_SERVICES = 3;
const MAX_AREAS = 5;

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
  Services?: { Category: string }[];
  Areas?: { Area: string }[];
  AreaCoverage?: ProviderAreaCoverage;
  Analytics?: ProviderAnalytics;
};

type ProviderByPhoneResponse = {
  ok?: boolean;
  provider?: ProviderProfile;
  error?: string;
  message?: string;
  debug?: unknown;
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

function parseJsonSafe<T>(text: string): T | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
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

    const current = acc[taskId] || { unreadProviderCount: 0, lastMessageAt: "" };
    const candidateTime = String(thread.LastMessageAt || thread.UpdatedAt || thread.CreatedAt || "").trim();
    const currentTime = String(current.lastMessageAt || "").trim();

    acc[taskId] = {
      unreadProviderCount: current.unreadProviderCount + (Number(thread.UnreadProviderCount) || 0),
      lastMessageAt:
        Date.parse(candidateTime || "") > Date.parse(currentTime || "") ? candidateTime : currentTime,
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

export default function ProviderDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const alreadyRegisteredNotice = searchParams.get("alreadyRegistered") === "true";
  const [phone, setPhone] = useState("");
  const [profile, setProfile] = useState<ProviderProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [apiError, setApiError] = useState("");
  const [apiDebug, setApiDebug] = useState<unknown>(null);
  const [debugPhone, setDebugPhone] = useState("");
  const [categoryDemandRange, setCategoryDemandRange] = useState<DemandRangeKey>("today");
  const [shareFeedback, setShareFeedback] = useState("");
  const [openingChatTaskId, setOpeningChatTaskId] = useState("");
  const [chatErrorByTaskId, setChatErrorByTaskId] = useState<Record<string, string>>({});
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
    const load = async () => {
      setLoading(true);
      setError("");
      setApiError("");
      setApiDebug(null);
      try {
        console.log("[provider/dashboard] api request", {
          endpoint: "/api/provider/dashboard-profile",
          payload: null,
          phoneFromSession: phone,
        });
        const profileRes = await fetch("/api/provider/dashboard-profile", { cache: "no-store" });
        const profileText = await profileRes.text();
        const profileData = parseJsonSafe<ProviderByPhoneResponse>(profileText);
        if (!profileRes.ok) {
          throw new Error(
            profileData?.message ||
              profileData?.error ||
              `HTTP ${profileRes.status} while loading provider profile.`
          );
        }
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
        setProfile(profileData.provider);

        if (typeof window !== "undefined") {
          window.localStorage.setItem(
            "kk_provider_profile",
            JSON.stringify({
              ProviderID: profileData.provider.ProviderID,
              Name: profileData.provider.ProviderName,
              Phone: profileData.provider.Phone,
              Verified: profileData.provider.Verified,
              OtpVerified: profileData.provider.OtpVerified,
              OtpVerifiedAt: profileData.provider.OtpVerifiedAt,
              LastLoginAt: profileData.provider.LastLoginAt,
              PendingApproval: profileData.provider.PendingApproval,
              Status:
                profileData.provider.Status ||
                (String(profileData.provider.PendingApproval || "").toLowerCase() === "yes"
                  ? "Pending Admin Approval"
                  : String(profileData.provider.OtpVerified || "").toLowerCase() === "yes"
                    ? "Active"
                    : "Not Verified"),
            })
          );
          window.dispatchEvent(new Event(PROVIDER_PROFILE_UPDATED_EVENT));
        }
      } catch (err) {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "Unable to load provider dashboard.");
        }
      } finally {
        if (!ignore) setLoading(false);
      }
    };

    void load();
    return () => {
      ignore = true;
    };
  }, [phone]);

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
          loggedInProviderPhone: phone,
        }),
      });
      const data = (await res.json()) as CreateThreadResponse;
      const threadId = extractThreadIdFromCreateThreadResponse(data);
      const finalHref = threadId ? `/chat/thread/${encodeURIComponent(threadId)}` : "";

      console.log("[provider/dashboard] open chat raw response", {
        status: res.status,
        ok: res.ok,
        data,
      });

      console.log("[provider/dashboard] open chat selection", {
        taskId,
        existingThreadId,
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
  const categoryDemand = useMemo(
    () =>
      Array.isArray(categoryDemandByRange[categoryDemandRange])
        ? categoryDemandByRange[categoryDemandRange]
        : [],
    [categoryDemandByRange, categoryDemandRange]
  );

  const servicesCount = services.length;
  const areasCount = areas.length;
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
  const statusLabel = verified
    ? "Phone Verified"
    : pendingApproval
      ? "Pending Admin Approval"
      : "Not Verified";
  const verificationMessage = verified
    ? "Your phone login is verified. Keep responding quickly to improve your conversion."
    : pendingApproval
      ? "Your profile is live, but one or more categories are waiting for admin review."
      : "Complete OTP login to show as phone verified and get higher user-facing ranking.";

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
  const acceptanceRate = Number(metrics.AcceptanceRate || 0);
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
      tone: "bg-slate-900 text-white border-slate-900",
      note: "Overall demand in your selected categories",
    },
    {
      title: "Matched To You",
      value: Number(metrics.TotalRequestsMatchedToMe || 0),
      tone: "bg-white text-slate-900 border-slate-200",
      note: "Leads where you were one of the matched providers",
    },
    {
      title: "Responded By You",
      value: Number(metrics.TotalRequestsRespondedByMe || 0),
      tone: "bg-emerald-50 text-emerald-900 border-emerald-200",
      note: `Response rate ${responseRate}%`,
    },
    {
      title: "Accepted By You",
      value: Number(metrics.TotalRequestsAcceptedByMe || 0),
      tone: "bg-sky-50 text-sky-900 border-sky-200",
      note: `Acceptance rate ${acceptanceRate}%`,
    },
    {
      title: "Completed By You",
      value: Number(metrics.TotalRequestsCompletedByMe || 0),
      tone: "bg-amber-50 text-amber-900 border-amber-200",
      note: "Completed jobs assigned to your provider ID",
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
        <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-sm">
          <div className="grid gap-6 px-6 py-7 lg:grid-cols-[minmax(0,1fr)_240px] lg:px-8">
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-sky-700">
                Provider Intelligence Dashboard
              </p>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                  {profile.ProviderName}
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  See where demand is building in your services, how often leads match to you,
                  and whether your current areas are strong opportunity zones.
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
              <p className="text-sm text-slate-600">{verificationMessage}</p>
              {profile && (
                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
                  <p className="font-semibold">What happens next?</p>
                  <p className="mt-1">
                    When a customer posts a task in your area, you will receive a WhatsApp notification and can respond instantly.
                  </p>
                  <p className="mt-1">
                    Make sure your services and areas are updated to receive relevant leads.
                  </p>
                </div>
              )}
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

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {statsCards.map((card) => (
            <div
              key={card.title}
              className={`rounded-[24px] border px-5 py-5 shadow-sm ${card.tone}`}
            >
              <p className="text-sm font-semibold">{card.title}</p>
              <p className="mt-3 text-3xl font-bold">{card.value}</p>
              <p className="mt-2 text-xs opacity-80">{card.note}</p>
            </div>
          ))}
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">My Demand Insights</h2>
              <p className="mt-1 text-sm text-slate-500">
                Quick signals to help you decide where to stay active and where to expand.
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
              Response rate: <span className="font-semibold text-slate-900">{responseRate}%</span>
            </div>
          </div>
          <div className="mt-5 grid gap-4 lg:grid-cols-3">
            {insightLines.map((line) => (
              <div
                key={line}
                className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm leading-6 text-slate-700"
              >
                {line}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-slate-900">City Demand by Service Category</h2>
              <p className="mt-1 text-sm text-slate-500">
                See which services are getting the most customer requests, then invite other workers to join and respond to demand.
              </p>
              <p className="mt-2 text-sm text-slate-600">Track live service demand across the city.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_DEMAND_RANGE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => {
                    setCategoryDemandRange(option.key);
                    setShareFeedback("");
                  }}
                  className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    categoryDemandRange === option.key
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {matrixInsightLines.map((line) => (
              <div
                key={line}
                className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-4 text-sm leading-6 text-slate-700"
              >
                {line}
              </div>
            ))}
          </div>

          {shareFeedback ? (
            <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-700">
              {shareFeedback}
            </div>
          ) : null}

          {categoryDemand.length ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {categoryDemand.map((item) => {
                const count = Number(item.RequestCount || 0);
                const level = getDemandLevel(count, maxCategoryDemandCount);
                return (
                  <article
                    key={item.CategoryName}
                    className="rounded-[24px] border border-slate-200 bg-[linear-gradient(180deg,#ffffff_0%,#f8fafc_100%)] p-5 shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{item.CategoryName}</h3>
                        <p className="mt-2 text-2xl font-bold text-slate-900">
                          {count} <span className="text-sm font-medium text-slate-500">Requests</span>
                        </p>
                      </div>
                      <span
                        className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getDemandBadgeClass(
                          level
                        )}`}
                      >
                        {level} Demand
                      </span>
                    </div>
                    <div className="mt-5 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleCopyInvite(item)}
                        className="inline-flex rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:border-slate-300 hover:bg-slate-50"
                      >
                        Copy Invite
                      </button>
                      <button
                        type="button"
                        onClick={() => handleWhatsAppShare(item)}
                        className="inline-flex rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700 transition hover:border-emerald-300 hover:bg-emerald-100"
                      >
                        WhatsApp Share
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="mt-6 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
              No category demand data yet.
            </div>
          )}

          <div className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50/70 px-5 py-5">
            <p className="text-sm font-semibold text-slate-900">
              Know someone who provides these services?
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Invite them to join Kaun Karega and start receiving customer work requests.
            </p>
            <p className="mt-4 text-sm font-semibold text-slate-900">
              क्या आप किसी ऐसे व्यक्ति को जानते हैं जो ये काम करता है?
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              उसे Kaun Karega से जोड़ें ताकि वह ग्राहकों की रिक्वेस्ट देखकर काम प्राप्त कर सके।
            </p>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-slate-900">Area Demand Heat Table</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Demand by area for your selected service categories.
                </p>
              </div>
            </div>
            {areaDemand.length ? (
              <div className="mt-5 overflow-x-auto">
                <table className="min-w-full text-left">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Area</th>
                      <th className="px-4 py-3 font-semibold">Request Count</th>
                      <th className="px-4 py-3 font-semibold">Demand Level</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
                    {areaDemand.map((item) => {
                      const level = getDemandLevel(Number(item.RequestCount || 0), maxDemandCount);
                      return (
                        <tr key={item.AreaName}>
                          <td className="px-4 py-3 font-medium text-slate-900">{item.AreaName}</td>
                          <td className="px-4 py-3">{Number(item.RequestCount || 0)}</td>
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getDemandBadgeClass(
                                level
                              )}`}
                            >
                              {level}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No demand data yet for your selected services.
              </div>
            )}
          </section>

          <section className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">My Selected Areas Performance</h2>
            <p className="mt-1 text-sm text-slate-500">
              Compare your current zones against actual request volume.
            </p>
            {selectedAreaDemand.length ? (
              <div className="mt-5 space-y-3">
                {selectedAreaDemand.map((item) => {
                  const level = getDemandLevel(
                    Number(item.RequestCount || 0),
                    selectedMaxDemandCount || maxDemandCount
                  );
                  return (
                    <div
                      key={item.AreaName}
                      className="rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-slate-900">{item.AreaName}</p>
                          <p className="mt-1 text-sm text-slate-500">
                            {Number(item.RequestCount || 0)} request
                            {Number(item.RequestCount || 0) === 1 ? "" : "s"} in your services
                          </p>
                        </div>
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-semibold ${getDemandBadgeClass(
                            level
                          )}`}
                        >
                          {level}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-sm text-slate-500">
                No selected area data yet. Add service areas to start comparing demand.
              </div>
            )}
          </section>
        </div>

        <section className="space-y-6">
            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Services ({servicesCount}/{MAX_SERVICES})
                  </h2>
                  {servicesCount === MAX_SERVICES ? (
                    <p className="mt-1 text-xs text-slate-500">Maximum services selected</p>
                  ) : null}
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
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700"
                    >
                      {service.Category}
                    </span>
                  ))
                ) : (
                  <p className="text-sm text-slate-500">No services added yet.</p>
                )}
              </div>
            </div>

            <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Area Coverage
                  </h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Active areas are used for matching. Pending requests wait for admin review.
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
                    Active Approved Areas ({activeCoverageAreas.length}/{MAX_AREAS})
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
                  <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
                    Pending Area Requests
                  </p>
                  <div className="mt-3 space-y-2">
                    {pendingAreaRequests.length ? (
                      pendingAreaRequests.map((item) => (
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
                      ))
                    ) : (
                      <p className="text-sm text-slate-500">No pending area requests.</p>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-sky-700">
                    Resolved Outcomes
                  </p>
                  <div className="mt-3 space-y-2">
                    {resolvedAreaRequests.length ? (
                      resolvedAreaRequests.map((item) => {
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
                      })
                    ) : (
                      <p className="text-sm text-slate-500">No resolved area requests yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>
      </div>
      <InAppToastStack
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))}
      />
    </main>
  );
}
