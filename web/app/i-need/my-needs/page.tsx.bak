"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getAuthSession } from "@/lib/auth";

type NeedStatus = "active" | "completed" | "expired" | "closed";

type MyNeed = {
  id: string;
  title: string;
  category: string;
  area: string;
  description: string;
  status: NeedStatus;
  postedDate: string;
  expiryDate: string;
  isAnonymous: boolean;
};

type NeedAction = "mark_complete" | "close";

type BackendNeed = {
  NeedID?: string;
  Title?: string;
  Category?: string;
  Area?: string;
  Description?: string;
  CreatedAt?: string;
  ExpiresAt?: string;
  CurrentStatus?: string;
  IsAnonymous?: boolean | string;
};

type GetMyNeedsResponse = {
  ok?: boolean;
  error?: string;
  message?: string;
  needs?: BackendNeed[];
};

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function normalizePhoneToTen(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  return digits.slice(-10);
}

function getUserPhone(): string {
  const session = getAuthSession();
  if (session?.phone) return normalizePhoneToTen(session.phone);
  return "";
}

function normalizeNeedStatus(value: string): NeedStatus {
  const status = String(value || "").trim().toLowerCase();
  if (status === "completed") return "completed";
  if (status === "expired") return "expired";
  if (status === "closed") return "closed";
  return "active";
}

function normalizeNeedBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function formatDateOnly(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "-";

  const slashMatch = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+\d{2}:\d{2}:\d{2})?$/
  );
  if (slashMatch) {
    const day = Number(slashMatch[1]);
    const monthIndex = Number(slashMatch[2]) - 1;
    const year = Number(slashMatch[3]);
    if (day && monthIndex >= 0 && monthIndex <= 11 && year) {
      return `${day} ${MONTH_LABELS[monthIndex]} ${year}`;
    }
    return raw;
  }

  const parsed = new Date(raw);
  const parsedTime = parsed.getTime();
  if (Number.isNaN(parsedTime)) return raw;

  const day = parsed.getDate();
  const monthIndex = parsed.getMonth();
  const year = parsed.getFullYear();
  if (!day || monthIndex < 0 || monthIndex > 11 || !year) return raw;

  return `${day} ${MONTH_LABELS[monthIndex]} ${year}`;
}

function mapNeed(item: BackendNeed): MyNeed {
  return {
    id: String(item.NeedID || "").trim(),
    title: String(item.Title || "").trim() || "Untitled need",
    category: String(item.Category || "").trim() || "Other",
    area: String(item.Area || "").trim() || "Area not specified",
    description:
      String(item.Description || "").trim() || "No description provided.",
    status: normalizeNeedStatus(String(item.CurrentStatus || "")),
    postedDate: formatDateOnly(String(item.CreatedAt || "").trim()),
    expiryDate: formatDateOnly(String(item.ExpiresAt || "").trim()),
    isAnonymous: normalizeNeedBoolean(item.IsAnonymous),
  };
}

const STATUS_CONFIG: Record<
  NeedStatus,
  { label: string; badge: string; dot: string }
> = {
  active: {
    label: "Active",
    badge: "border-emerald-100 bg-emerald-50 text-emerald-700",
    dot: "bg-emerald-500",
  },
  completed: {
    label: "Completed",
    badge: "border-sky-100 bg-sky-50 text-sky-700",
    dot: "bg-sky-500",
  },
  expired: {
    label: "Expired",
    badge: "border-amber-100 bg-amber-50 text-amber-700",
    dot: "bg-amber-400",
  },
  closed: {
    label: "Closed",
    badge: "border-slate-200 bg-slate-100 text-slate-500",
    dot: "bg-slate-400",
  },
};

const SUMMARY_STATS: { label: string; status: NeedStatus; color: string }[] = [
  { label: "Active", status: "active", color: "text-emerald-600" },
  { label: "Completed", status: "completed", color: "text-sky-600" },
  { label: "Expired", status: "expired", color: "text-amber-500" },
  { label: "Closed", status: "closed", color: "text-slate-500" },
];

function SummaryStrip({ needs }: { needs: MyNeed[] }) {
  const counts = needs.reduce<Record<NeedStatus, number>>(
    (acc, n) => {
      acc[n.status] = (acc[n.status] ?? 0) + 1;
      return acc;
    },
    { active: 0, completed: 0, expired: 0, closed: 0 }
  );

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {SUMMARY_STATS.map(({ label, status, color }) => (
        <div
          key={status}
          className="rounded-2xl border border-slate-200 bg-white px-4 py-4 shadow-sm"
        >
          <p className={`text-2xl font-bold ${color}`}>{counts[status]}</p>
          <p className="mt-0.5 text-xs font-medium text-slate-500">{label}</p>
        </div>
      ))}
    </div>
  );
}

function NeedManagementCard({
  need,
  onMarkComplete,
  onClose,
  isPending,
}: {
  need: MyNeed;
  onMarkComplete: (id: string) => void;
  onClose: (id: string) => void;
  isPending: boolean;
}) {
  const cfg = STATUS_CONFIG[need.status];
  const isActionable = need.status === "active" && !isPending;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold leading-snug text-slate-900 sm:text-base">
          {need.title}
        </h3>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${cfg.badge}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
          {cfg.label}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">
          {need.category}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs text-slate-600">
          <svg
            className="h-3 w-3 shrink-0 text-slate-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
          {need.area}
        </span>
        {need.isAnonymous && (
          <span className="inline-flex items-center rounded-full border border-[#003d20]/15 bg-[#003d20]/5 px-2.5 py-0.5 text-xs font-medium text-[#003d20]">
            Anonymous
          </span>
        )}
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-slate-500 line-clamp-2">
        {need.description}
      </p>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>
          Posted:{" "}
          <span className="font-medium text-slate-500">{need.postedDate}</span>
        </span>
        <span>
          Expires:{" "}
          <span className="font-medium text-slate-500">{need.expiryDate}</span>
        </span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <button
          type="button"
          disabled={!isActionable}
          onClick={() => onMarkComplete(need.id)}
          className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
            isActionable
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
          }`}
        >
          {isPending ? "Updating..." : "Mark Complete"}
        </button>
        <button
          type="button"
          disabled={!isActionable}
          onClick={() => onClose(need.id)}
          className={`rounded-xl border px-3 py-1.5 text-xs font-semibold transition ${
            isActionable
              ? "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              : "border-slate-100 bg-slate-50 text-slate-300 cursor-not-allowed"
          }`}
        >
          Close Post
        </button>
        <Link
          href={`/i-need/my-needs/${encodeURIComponent(need.id)}/responses`}
          className="ml-auto rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          View Responses
        </Link>
      </div>
    </article>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-14 text-center">
      <div className="text-4xl">📋</div>
      <h3 className="mt-3 text-base font-semibold text-slate-800">
        No needs posted yet
      </h3>
      <p className="mt-1 max-w-xs text-sm text-slate-500">
        You haven&apos;t posted any needs. Let people nearby know what
        you&apos;re looking for.
      </p>
      <Link
        href="/i-need/post"
        className="mt-5 inline-flex rounded-xl bg-orange-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-orange-600"
      >
        Post Your First Need
      </Link>
    </div>
  );
}

const FILTER_TABS: { label: string; value: NeedStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "active" },
  { label: "Completed", value: "completed" },
  { label: "Expired", value: "expired" },
  { label: "Closed", value: "closed" },
];

export default function MyNeedsPage() {
  const [needs, setNeeds] = useState<MyNeed[]>([]);
  const [activeTab, setActiveTab] = useState<NeedStatus | "all">("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingByNeedId, setPendingByNeedId] = useState<Record<string, NeedAction | null>>({});

  useEffect(() => {
    let ignore = false;

    const loadNeeds = async () => {
      const userPhone = getUserPhone();
      if (!userPhone) {
        if (!ignore) {
          setNeeds([]);
          setError("Please verify your phone number to view your needs.");
          setIsLoading(false);
        }
        return;
      }

      try {
        if (!ignore) {
          setIsLoading(true);
          setError("");
        }

        const response = await fetch("/api/kk", {
          method: "POST",
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "get_my_needs",
            UserPhone: userPhone,
          }),
        });

        const data = (await response.json()) as GetMyNeedsResponse;
        if (!response.ok || data?.ok !== true) {
          throw new Error(data?.error || data?.message || "Failed to load your needs.");
        }

        if (!ignore) {
          const items = Array.isArray(data?.needs) ? data.needs.map(mapNeed) : [];
          setNeeds(items);
        }
      } catch (err) {
        if (!ignore) {
          setNeeds([]);
          setError(
            err instanceof Error ? err.message : "Failed to load your needs."
          );
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    };

    void loadNeeds();

    return () => {
      ignore = true;
    };
  }, []);

  async function runNeedAction(needId: string, action: NeedAction) {
    const userPhone = getUserPhone();
    if (!userPhone) {
      setError("Please verify your phone number to manage your needs.");
      return;
    }

    setError("");
    setPendingByNeedId((current) => ({
      ...current,
      [needId]: action,
    }));

    try {
      const response = await fetch("/api/kk", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: action === "mark_complete" ? "mark_need_complete" : "close_need",
          NeedID: needId,
          UserPhone: userPhone,
        }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || data?.ok !== true) {
        throw new Error(data?.error || data?.message || "Failed to update need.");
      }

      setNeeds((current) =>
        current.map((need) =>
          need.id === needId
            ? {
                ...need,
                status: action === "mark_complete" ? "completed" : "closed",
              }
            : need
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update need.");
    } finally {
      setPendingByNeedId((current) => ({
        ...current,
        [needId]: null,
      }));
    }
  }

  function handleMarkComplete(id: string) {
    void runNeedAction(id, "mark_complete");
  }

  function handleClose(id: string) {
    void runNeedAction(id, "close");
  }

  const filtered = useMemo(() => {
    return activeTab === "all" ? needs : needs.filter((n) => n.status === activeTab);
  }, [activeTab, needs]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-3xl px-4 pb-16 pt-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-[#003d20]">
            Jodhpur ko chahiye
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">
            My Requests
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Track and manage the needs you&apos;ve posted.
          </p>
        </div>

        <div className="mb-6">
          <SummaryStrip needs={needs} />
        </div>

        <div className="mb-4 flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
          {FILTER_TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveTab(tab.value)}
              className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
                activeTab === tab.value
                  ? "bg-[#003d20] text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {error ? (
          <div className="mb-4 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
            <p className="text-sm text-slate-500">Loading your needs...</p>
          </div>
        ) : filtered.length === 0 ? (
          needs.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center">
              <p className="text-sm text-slate-500">
                No needs with status{" "}
                <span className="font-medium capitalize text-slate-700">
                  {activeTab}
                </span>
                .
              </p>
            </div>
          )
        ) : (
          <div className="space-y-3">
            {filtered.map((need) => (
              <NeedManagementCard
                key={need.id}
                need={need}
                onMarkComplete={handleMarkComplete}
                onClose={handleClose}
                isPending={Boolean(pendingByNeedId[need.id])}
              />
            ))}
          </div>
        )}

        {needs.length > 0 && (
          <div className="mt-8 flex justify-center">
            <Link
              href="/i-need/post"
              className="inline-flex items-center gap-2 rounded-xl border border-[#003d20] bg-white px-5 py-2.5 text-sm font-semibold text-[#003d20] shadow-sm transition hover:bg-[#003d20]/5"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Post Another Need
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
