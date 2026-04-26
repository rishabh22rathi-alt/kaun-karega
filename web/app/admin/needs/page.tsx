"use client";

import { useEffect, useMemo, useState } from "react";

type NeedStatus = "active" | "completed" | "expired" | "closed";
type StatusTab = "All" | "Active" | "Completed" | "Expired" | "Closed" | "Hidden";
type NeedAction = "hide" | "unhide" | "close" | "rank";

type AdminNeedApiItem = {
  NeedID?: string;
  Title?: string;
  Category?: string;
  Area?: string;
  PosterLabel?: string;
  UserPhone?: string;
  CurrentStatus?: string;
  CreatedAt?: string;
  ExpiresAt?: string;
  PriorityRank?: number | string;
  IsHidden?: boolean | string;
};

type AdminNeedsResponse = {
  ok?: boolean;
  needs?: AdminNeedApiItem[];
  error?: string;
  message?: string;
};

type AdminNeed = {
  needId: string;
  title: string;
  category: string;
  area: string;
  userLabel: string;
  status: NeedStatus;
  isHidden: boolean;
  createdDate: string;
  expiryDate: string;
  rank: number;
};

const CATEGORY_OPTIONS = [
  "All Categories",
  "Employer",
  "Employee",
  "Property Seller",
  "Property Buyer",
  "Landlord",
  "Tenant",
  "Vehicle Seller",
  "Vehicle Buyer",
  "Other",
];

const AREA_OPTIONS = [
  "All Areas",
  "Sardarpura",
  "Shastri Nagar",
  "Ratanada",
  "Paota",
  "Basni",
  "Pal Road",
  "Chopasni Housing Board",
  "Mandore",
  "Soorsagar",
  "Kudi Bhagtasni",
];

const STATUS_TABS = ["All", "Active", "Completed", "Expired", "Closed", "Hidden"] as const;

const STATUS_BADGE: Record<NeedStatus, string> = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  completed: "border-sky-200 bg-sky-50 text-sky-700",
  expired: "border-amber-200 bg-amber-50 text-amber-700",
  closed: "border-slate-200 bg-slate-100 text-slate-500",
};

function normalizeNeedStatus(value: string): NeedStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "completed") return "completed";
  if (normalized === "expired") return "expired";
  if (normalized === "closed") return "closed";
  return "active";
}

function normalizeNeedBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function normalizeNeedRank(value: unknown): number {
  const rank = Number(value);
  return Number.isFinite(rank) ? rank : 0;
}

function maskUserPhone(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 4) return "Unknown user";
  const tail = digits.slice(-10);
  if (tail.length < 7) return tail;
  return `${tail.slice(0, 5)}•••${tail.slice(-2)}`;
}

function mapNeed(item: AdminNeedApiItem): AdminNeed {
  const posterLabel = String(item.PosterLabel || "").trim();
  const userPhone = String(item.UserPhone || "").trim();
  return {
    needId: String(item.NeedID || "").trim(),
    title: String(item.Title || "").trim() || "Untitled need",
    category: String(item.Category || "").trim() || "Other",
    area: String(item.Area || "").trim() || "Area not specified",
    userLabel: posterLabel || maskUserPhone(userPhone),
    status: normalizeNeedStatus(String(item.CurrentStatus || "")),
    isHidden: normalizeNeedBoolean(item.IsHidden),
    createdDate: String(item.CreatedAt || "").trim() || "-",
    expiryDate: String(item.ExpiresAt || "").trim() || "-",
    rank: normalizeNeedRank(item.PriorityRank),
  };
}

function buildRequestStatus(tab: StatusTab): string {
  if (tab === "All") return "all";
  return tab.toLowerCase();
}

async function fetchAdminNeeds(filters?: {
  status?: string;
  category?: string;
  area?: string;
  search?: string;
}) {
  const payload: Record<string, string> = {
    action: "admin_get_needs",
  };

  if (filters?.status && filters.status !== "all") payload.Status = filters.status;
  if (filters?.category && filters.category !== "All Categories") {
    payload.Category = filters.category;
  }
  if (filters?.area && filters.area !== "All Areas") {
    payload.Area = filters.area;
  }
  if (filters?.search) payload.Search = filters.search;

  const response = await fetch("/api/kk", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = (await response.json()) as AdminNeedsResponse;
  if (!response.ok || data?.ok !== true) {
    throw new Error(data?.error || data?.message || "Failed to load needs.");
  }

  return Array.isArray(data?.needs) ? data.needs.map(mapNeed) : [];
}

function StatusBadge({ status }: { status: NeedStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold capitalize ${STATUS_BADGE[status]}`}
    >
      {status}
    </span>
  );
}

function HiddenBadge() {
  return (
    <span className="inline-flex items-center rounded-full border border-rose-200 bg-rose-50 px-2.5 py-0.5 text-xs font-semibold text-rose-600">
      Hidden
    </span>
  );
}

function RowActions({
  need,
  rankValue,
  pendingAction,
  onToggleHide,
  onClose,
  onRankInputChange,
  onRankCommit,
}: {
  need: AdminNeed;
  rankValue: string;
  pendingAction: NeedAction | null;
  onToggleHide: (id: string, hidden: boolean) => void;
  onClose: (id: string) => void;
  onRankInputChange: (id: string, value: string) => void;
  onRankCommit: (id: string) => void;
}) {
  const canClose = need.status === "active" && pendingAction === null;
  const isPending = pendingAction !== null;

  return (
    <div className="flex items-center justify-end gap-2">
      <input
        type="number"
        min={0}
        max={99}
        value={rankValue}
        disabled={isPending}
        onChange={(e) => onRankInputChange(need.needId, e.target.value)}
        onBlur={() => onRankCommit(need.needId)}
        title="Priority rank"
        className="w-14 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center text-xs text-slate-700 focus:border-violet-400 focus:outline-none disabled:opacity-50"
      />
      <button
        type="button"
        disabled={isPending}
        onClick={() => onToggleHide(need.needId, need.isHidden)}
        className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
          need.isHidden
            ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
            : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
        } disabled:cursor-not-allowed disabled:opacity-40`}
      >
        {pendingAction === "hide" || pendingAction === "unhide"
          ? "Updating..."
          : need.isHidden
            ? "Unhide"
            : "Hide"}
      </button>
      <button
        type="button"
        disabled={!canClose}
        onClick={() => onClose(need.needId)}
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pendingAction === "close" ? "Closing..." : "Close"}
      </button>
      <button
        type="button"
        className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        View
      </button>
    </div>
  );
}

function MobileCard({
  need,
  rankValue,
  pendingAction,
  onToggleHide,
  onClose,
  onRankInputChange,
  onRankCommit,
}: {
  need: AdminNeed;
  rankValue: string;
  pendingAction: NeedAction | null;
  onToggleHide: (id: string, hidden: boolean) => void;
  onClose: (id: string) => void;
  onRankInputChange: (id: string, value: string) => void;
  onRankCommit: (id: string) => void;
}) {
  const canClose = need.status === "active" && pendingAction === null;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-mono text-slate-400">{need.needId}</p>
          <p className="mt-0.5 text-sm font-semibold leading-snug text-slate-900">
            {need.title}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <StatusBadge status={need.status} />
          {need.isHidden ? <HiddenBadge /> : null}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
        <span>{need.category}</span>
        <span>·</span>
        <span>{need.area}</span>
        <span>·</span>
        <span>{need.userLabel}</span>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-400">
        <span>Created: {need.createdDate}</span>
        <span>Expires: {need.expiryDate}</span>
        <span>Rank: {need.rank}</span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <input
          type="number"
          min={0}
          max={99}
          value={rankValue}
          disabled={pendingAction !== null}
          onChange={(e) => onRankInputChange(need.needId, e.target.value)}
          onBlur={() => onRankCommit(need.needId)}
          title="Priority rank"
          className="w-14 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-center text-xs text-slate-700 focus:border-violet-400 focus:outline-none disabled:opacity-50"
        />
        <button
          type="button"
          disabled={pendingAction !== null}
          onClick={() => onToggleHide(need.needId, need.isHidden)}
          className={`rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
            need.isHidden
              ? "border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
          } disabled:cursor-not-allowed disabled:opacity-40`}
        >
          {pendingAction === "hide" || pendingAction === "unhide"
            ? "Updating..."
            : need.isHidden
              ? "Unhide"
              : "Hide"}
        </button>
        <button
          type="button"
          disabled={!canClose}
          onClick={() => onClose(need.needId)}
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pendingAction === "close" ? "Closing..." : "Close"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          View
        </button>
      </div>
    </div>
  );
}

export default function AdminNeedsPage() {
  const [needs, setNeeds] = useState<AdminNeed[]>([]);
  const [activeTab, setActiveTab] = useState<StatusTab>("All");
  const [category, setCategory] = useState("All Categories");
  const [area, setArea] = useState("All Areas");
  const [search, setSearch] = useState("");
  const [appliedCategory, setAppliedCategory] = useState("All Categories");
  const [appliedArea, setAppliedArea] = useState("All Areas");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingByNeedId, setPendingByNeedId] = useState<Record<string, NeedAction | null>>({});
  const [rankInputs, setRankInputs] = useState<Record<string, string>>({});

  async function loadNeeds(next?: {
    tab?: StatusTab;
    category?: string;
    area?: string;
    search?: string;
  }) {
    const nextTab = next?.tab ?? activeTab;
    const nextCategory = next?.category ?? appliedCategory;
    const nextArea = next?.area ?? appliedArea;
    const nextSearch = next?.search ?? appliedSearch;

    setIsLoading(true);
    setError("");

    try {
      const items = await fetchAdminNeeds({
        status: buildRequestStatus(nextTab),
        category: nextCategory,
        area: nextArea,
        search: nextSearch,
      });
      setNeeds(items);
      setRankInputs(
        items.reduce<Record<string, string>>((acc, item) => {
          acc[item.needId] = String(item.rank);
          return acc;
        }, {})
      );
    } catch (err) {
      setNeeds([]);
      setRankInputs({});
      setError(err instanceof Error ? err.message : "Failed to load needs.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadNeeds({ tab: "All", category: "All Categories", area: "All Areas", search: "" });
  }, []);

  function applyFilters() {
    const nextSearch = search.trim();
    setAppliedCategory(category);
    setAppliedArea(area);
    setAppliedSearch(nextSearch);
    void loadNeeds({
      tab: activeTab,
      category,
      area,
      search: nextSearch,
    });
  }

  function clearFilters() {
    setActiveTab("All");
    setCategory("All Categories");
    setArea("All Areas");
    setSearch("");
    setAppliedCategory("All Categories");
    setAppliedArea("All Areas");
    setAppliedSearch("");
    void loadNeeds({
      tab: "All",
      category: "All Categories",
      area: "All Areas",
      search: "",
    });
  }

  function setPending(needId: string, action: NeedAction | null) {
    setPendingByNeedId((current) => ({
      ...current,
      [needId]: action,
    }));
  }

  async function handleToggleHide(needId: string, isHidden: boolean) {
    if (pendingByNeedId[needId]) return;
    const action = isHidden ? "admin_unhide_need" : "admin_hide_need";
    setPending(needId, isHidden ? "unhide" : "hide");
    setError("");

    try {
      const response = await fetch("/api/kk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          NeedID: needId,
        }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || data?.ok !== true) {
        throw new Error(data?.error || data?.message || "Failed to update need visibility.");
      }

      setNeeds((current) =>
        current.map((need) =>
          need.needId === needId ? { ...need, isHidden: !isHidden } : need
        )
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to update need visibility."
      );
    } finally {
      setPending(needId, null);
    }
  }

  async function handleClose(needId: string) {
    if (pendingByNeedId[needId]) return;
    setPending(needId, "close");
    setError("");

    try {
      const response = await fetch("/api/kk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "admin_close_need",
          NeedID: needId,
        }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || data?.ok !== true) {
        throw new Error(data?.error || data?.message || "Failed to close need.");
      }

      setNeeds((current) =>
        current.map((need) =>
          need.needId === needId ? { ...need, status: "closed" } : need
        )
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to close need.");
    } finally {
      setPending(needId, null);
    }
  }

  function handleRankInputChange(needId: string, value: string) {
    setRankInputs((current) => ({
      ...current,
      [needId]: value,
    }));
  }

  async function handleRankCommit(needId: string) {
    const currentNeed = needs.find((need) => need.needId === needId);
    if (!currentNeed || pendingByNeedId[needId]) return;

    const nextRank = normalizeNeedRank(rankInputs[needId]);
    if (nextRank === currentNeed.rank && String(rankInputs[needId] ?? "") === String(currentNeed.rank)) {
      return;
    }

    setPending(needId, "rank");
    setError("");

    try {
      const response = await fetch("/api/kk", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "admin_set_need_rank",
          NeedID: needId,
          PriorityRank: nextRank,
        }),
      });

      const data = (await response.json()) as { ok?: boolean; error?: string; message?: string };
      if (!response.ok || data?.ok !== true) {
        throw new Error(data?.error || data?.message || "Failed to update rank.");
      }

      setNeeds((current) =>
        current.map((need) =>
          need.needId === needId ? { ...need, rank: nextRank } : need
        )
      );
      setRankInputs((current) => ({
        ...current,
        [needId]: String(nextRank),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update rank.");
      setRankInputs((current) => ({
        ...current,
        [needId]: String(currentNeed.rank),
      }));
    } finally {
      setPending(needId, null);
    }
  }

  const resultCount = useMemo(() => needs.length, [needs]);

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-slate-500">Post a Request</p>
        <h1 className="text-2xl font-semibold text-slate-900">Manage Needs</h1>
        <p className="text-sm text-slate-600">Monitor and control all user-posted needs.</p>
      </div>

      <div className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold transition ${
              activeTab === tab
                ? "bg-violet-600 text-white shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">Category</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none"
            >
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-600">Area</label>
            <input
              list="admin-needs-area-options"
              value={area}
              onChange={(e) => setArea(e.target.value)}
              placeholder="Type or choose an area"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 focus:border-violet-400 focus:outline-none"
            />
            <datalist id="admin-needs-area-options">
              {AREA_OPTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </div>
          <div className="flex-[1.4]">
            <label className="mb-1 block text-xs font-medium text-slate-600">Search</label>
            <input
              type="text"
              placeholder="Title, Need ID, user..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && applyFilters()}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-violet-400 focus:outline-none"
            />
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={applyFilters}
              className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <p className="text-sm text-slate-500">
        Showing <span className="font-semibold text-slate-700">{resultCount}</span>{" "}
        {resultCount === 1 ? "need" : "needs"}
      </p>

      <div className="hidden overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:block">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3 font-semibold">Need ID</th>
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">Category</th>
                <th className="px-4 py-3 font-semibold">Area</th>
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Created</th>
                <th className="px-4 py-3 font-semibold">Expires</th>
                <th className="px-4 py-3 font-semibold text-center">Rank</th>
                <th className="px-4 py-3 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">
                    Loading needs...
                  </td>
                </tr>
              ) : needs.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">
                    No needs match the current filters.
                  </td>
                </tr>
              ) : (
                needs.map((need) => (
                  <tr key={need.needId} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{need.needId}</td>
                    <td className="max-w-[200px] px-4 py-3">
                      <span className="block truncate font-medium text-slate-900" title={need.title}>
                        {need.title}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{need.category}</td>
                    <td className="px-4 py-3 text-slate-600">{need.area}</td>
                    <td className="px-4 py-3 text-xs text-slate-500">{need.userLabel}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <StatusBadge status={need.status} />
                        {need.isHidden ? <HiddenBadge /> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{need.createdDate}</td>
                    <td className="px-4 py-3 text-slate-600">{need.expiryDate}</td>
                    <td className="px-4 py-3 text-center text-slate-600">{need.rank}</td>
                    <td className="px-4 py-3">
                      <RowActions
                        need={need}
                        rankValue={rankInputs[need.needId] ?? String(need.rank)}
                        pendingAction={pendingByNeedId[need.needId] ?? null}
                        onToggleHide={handleToggleHide}
                        onClose={handleClose}
                        onRankInputChange={handleRankInputChange}
                        onRankCommit={handleRankCommit}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {isLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-white px-6 py-10 text-center text-sm text-slate-500 shadow-sm">
            Loading needs...
          </div>
        ) : needs.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-sm text-slate-500">
            No needs match the current filters.
          </div>
        ) : (
          needs.map((need) => (
            <MobileCard
              key={need.needId}
              need={need}
              rankValue={rankInputs[need.needId] ?? String(need.rank)}
              pendingAction={pendingByNeedId[need.needId] ?? null}
              onToggleHide={handleToggleHide}
              onClose={handleClose}
              onRankInputChange={handleRankInputChange}
              onRankCommit={handleRankCommit}
            />
          ))
        )}
      </div>
    </div>
  );
}
