"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Admin dashboard tab — Provider Plan Growth.
 *
 * Read-only analytics view. Calls
 * GET /api/admin/provider-plans/growth-summary and renders the totals/
 * scheduled/expiring/revenue snapshot.
 *
 * Freshness:
 *   - Loads on accordion open (no auto-load on page mount).
 *   - Does not auto-poll.
 *   - Refresh button hits the same endpoint with ?refresh=1 to bypass
 *     the L1+L2 cache. The freshness pill flips Fresh/Cached based on
 *     the response's cache.cached flag; "Last updated" renders from
 *     cache.last_updated_at via the en-IN locale.
 *
 * Layout: accordion shell mirrors ScheduledPlansTab/SystemHealthTab.
 * No third-party chart library — conversion meter is a plain CSS bar.
 */

type GrowthSummary = {
  totals: {
    totalProviders: number;
    free: number;
    regions5: number;
    allJodhpur: number;
    expiredPaid: number;
    activePaid: number;
  };
  scheduled: {
    free: number;
    regions5: number;
    allJodhpur: number;
    dueNow: number;
  };
  expiring: {
    next3Days: number;
    next7Days: number;
    expiredButNotActivated: number;
  };
  revenue: {
    currentMonthlyEstimate: number;
    regions5Revenue: number;
    allJodhpurRevenue: number;
    paidProviderCount: number;
    freeToPaidConversionPercent: number;
  };
  notes: string[];
};

type CacheMetadata = {
  cached: boolean;
  last_updated_at: string;
  expires_at?: string;
  ttl_seconds?: number;
  refresh_available?: boolean;
  computed_by?: string | null;
  computed_duration_ms?: number | null;
};

type ApiResponse = {
  ok?: boolean;
  data?: GrowthSummary;
  cache?: CacheMetadata;
  error?: string;
  message?: string;
};

function formatINR(n: number): string {
  // en-IN locale uses the lakh/crore grouping which is what an Indian
  // admin expects when scanning rupee amounts. Symbol prepended; no
  // currency-style decimals because the values are integers.
  if (!Number.isFinite(n)) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function formatPercent(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function formatTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  try {
    return new Date(t).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(t).toISOString();
  }
}

// Tight relative-time formatter for the freshness pill. Avoids pulling
// in date-fns or moment — pure JS, same output style as the existing
// admin "Last updated" pills in PushAnalyticsTab.
function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diffMs = Date.now() - t;
  if (diffMs < 0) return "just now";
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 30) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// Display-friendly card definitions. Tailwind classes match the
// SystemHealthTab/PushAnalyticsTab StatCard pattern: colored border,
// soft tinted background, label uppercase tiny, value 2xl bold.
type CardTone = "slate" | "emerald" | "amber" | "sky" | "rose" | "violet";

const TONE: Record<CardTone, { border: string; bg: string; label: string; value: string }> = {
  slate: {
    border: "border-slate-200",
    bg: "bg-slate-50",
    label: "text-slate-600",
    value: "text-slate-900",
  },
  emerald: {
    border: "border-emerald-200",
    bg: "bg-emerald-50",
    label: "text-emerald-700",
    value: "text-emerald-900",
  },
  amber: {
    border: "border-amber-200",
    bg: "bg-amber-50",
    label: "text-amber-700",
    value: "text-amber-900",
  },
  sky: {
    border: "border-sky-200",
    bg: "bg-sky-50",
    label: "text-sky-700",
    value: "text-sky-900",
  },
  rose: {
    border: "border-rose-200",
    bg: "bg-rose-50",
    label: "text-rose-700",
    value: "text-rose-900",
  },
  violet: {
    border: "border-violet-200",
    bg: "bg-violet-50",
    label: "text-violet-700",
    value: "text-violet-900",
  },
};

function StatCard({
  label,
  value,
  tone = "slate",
  testId,
}: {
  label: string;
  value: string;
  tone?: CardTone;
  testId?: string;
}) {
  const t = TONE[tone];
  return (
    <div className={`rounded-xl border ${t.border} ${t.bg} p-3`}>
      <p
        className={`text-[11px] font-semibold uppercase tracking-wide ${t.label}`}
      >
        {label}
      </p>
      <p
        data-testid={testId}
        className={`mt-1 text-2xl font-bold ${t.value}`}
      >
        {value}
      </p>
    </div>
  );
}

export default function ProviderPlanGrowthTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<GrowthSummary | null>(null);
  const [cache, setCache] = useState<CacheMetadata | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  const fetchSummary = useCallback(async (forceRefresh: boolean) => {
    setLoading(true);
    setError(null);
    const url = forceRefresh
      ? "/api/admin/provider-plans/growth-summary?refresh=1"
      : "/api/admin/provider-plans/growth-summary";
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
      });
      const body = (await res.json().catch(() => null)) as ApiResponse | null;
      if (!res.ok || !body?.ok || !body.data) {
        setError(
          body?.message ||
            body?.error ||
            `Failed to load growth summary (${res.status}).`
        );
        setData(null);
        setCache(null);
        return;
      }
      setData(body.data);
      setCache(body.cache ?? null);
    } catch {
      setError("Network error while loading growth summary.");
      setData(null);
      setCache(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (data || loading) return;
    void fetchSummary(false);
  }, [isOpen, data, loading, fetchSummary]);

  const handleRefresh = useCallback(() => {
    if (loading) return;
    void fetchSummary(true);
  }, [loading, fetchSummary]);

  const conversionPercent = data?.revenue.freeToPaidConversionPercent ?? 0;
  // Clamp the visual bar width to the 0–100 range even if the API ever
  // returns a value outside it (defensive — the route does Math.round
  // on integer arithmetic so this shouldn't happen, but a wrong-shape
  // response shouldn't render a 200% bar).
  const conversionPercentVisual = Math.max(0, Math.min(100, conversionPercent));

  const freshnessText = cache
    ? cache.cached
      ? `Cached · ${relativeTime(cache.last_updated_at)}`
      : `Fresh · ${relativeTime(cache.last_updated_at)}`
    : "—";
  const freshnessTone = cache?.cached
    ? "border-slate-300 bg-slate-100 text-slate-700"
    : "border-emerald-300 bg-emerald-100 text-emerald-800";

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="provider-plan-growth-tab-body"
        data-testid="provider-plan-growth-tab-toggle"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">
            Provider Plan Growth
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Track active provider plans, scheduled next-cycle movement, and
            per-cycle gross revenue.
          </p>
        </div>
        <ChevronDown
          aria-hidden="true"
          className={`h-5 w-5 shrink-0 text-slate-400 transition-transform ${
            isOpen ? "rotate-180" : "rotate-0"
          }`}
        />
      </button>

      {isOpen && (
        <div
          id="provider-plan-growth-tab-body"
          className="space-y-5 border-t border-slate-200 px-5 py-5"
        >
          {/* Freshness + refresh controls */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span
                data-testid="provider-plan-growth-freshness-pill"
                className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${freshnessTone}`}
              >
                {freshnessText}
              </span>
              {cache?.last_updated_at ? (
                <span className="text-xs text-slate-500">
                  Last updated {formatTimestamp(cache.last_updated_at)}
                </span>
              ) : null}
            </div>
            <button
              type="button"
              data-testid="provider-plan-growth-refresh"
              onClick={handleRefresh}
              disabled={loading}
              className="inline-flex items-center justify-center rounded-xl border border-[#003d20] bg-white px-3 py-1.5 text-xs font-semibold text-[#003d20] transition hover:bg-[#003d20] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>

          {/* Error banner */}
          {error ? (
            <div
              role="alert"
              data-testid="provider-plan-growth-error"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {error}
            </div>
          ) : null}

          {/* Loading shimmer (only when there is no data yet) */}
          {!data && loading ? (
            <p className="py-6 text-center text-sm text-slate-500">Loading…</p>
          ) : null}

          {/* Main payload */}
          {data ? (
            <>
              {/* Top stat grid — 6 cards */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
                <StatCard
                  label="Total Providers"
                  value={data.totals.totalProviders.toLocaleString("en-IN")}
                  tone="slate"
                  testId="provider-plan-growth-stat-total"
                />
                <StatCard
                  label="Free Plan"
                  value={data.totals.free.toLocaleString("en-IN")}
                  tone="slate"
                  testId="provider-plan-growth-stat-free"
                />
                <StatCard
                  label="₹31 / 5 Regions"
                  value={data.totals.regions5.toLocaleString("en-IN")}
                  tone="emerald"
                  testId="provider-plan-growth-stat-regions5"
                />
                <StatCard
                  label="₹101 / Full Jodhpur"
                  value={data.totals.allJodhpur.toLocaleString("en-IN")}
                  tone="violet"
                  testId="provider-plan-growth-stat-all-jodhpur"
                />
                <StatCard
                  label="Active Paid"
                  value={data.totals.activePaid.toLocaleString("en-IN")}
                  tone="emerald"
                  testId="provider-plan-growth-stat-active-paid"
                />
                <StatCard
                  label="Per-cycle gross (₹/30d)"
                  value={formatINR(data.revenue.currentMonthlyEstimate)}
                  tone="emerald"
                  testId="provider-plan-growth-stat-revenue"
                />
              </div>

              {/* Conversion meter */}
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">
                    Paid conversion
                  </p>
                  <p
                    data-testid="provider-plan-growth-conversion-value"
                    className="text-sm font-bold text-emerald-700"
                  >
                    {formatPercent(conversionPercent)}
                  </p>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    aria-hidden="true"
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${conversionPercentVisual}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  Active paid ÷ total providers.
                </p>
              </div>

              {/* Scheduled next-cycle */}
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-800">
                  Scheduled next cycle
                </p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <StatCard
                    label="Scheduled Free"
                    value={data.scheduled.free.toLocaleString("en-IN")}
                    tone="sky"
                    testId="provider-plan-growth-stat-scheduled-free"
                  />
                  <StatCard
                    label="Scheduled ₹31"
                    value={data.scheduled.regions5.toLocaleString("en-IN")}
                    tone="sky"
                    testId="provider-plan-growth-stat-scheduled-regions5"
                  />
                  {data.scheduled.allJodhpur > 0 ? (
                    <StatCard
                      label="Scheduled ₹101"
                      value={data.scheduled.allJodhpur.toLocaleString("en-IN")}
                      tone="sky"
                      testId="provider-plan-growth-stat-scheduled-all-jodhpur"
                    />
                  ) : null}
                  <StatCard
                    label="Due Now"
                    value={data.scheduled.dueNow.toLocaleString("en-IN")}
                    tone={data.scheduled.dueNow > 0 ? "amber" : "slate"}
                    testId="provider-plan-growth-stat-due-now"
                  />
                </div>
              </div>

              {/* Expiring */}
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-800">
                  Expiring
                </p>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <StatCard
                    label="Next 3 days"
                    value={data.expiring.next3Days.toLocaleString("en-IN")}
                    tone="amber"
                    testId="provider-plan-growth-stat-expiring-3d"
                  />
                  <StatCard
                    label="Next 7 days"
                    value={data.expiring.next7Days.toLocaleString("en-IN")}
                    tone="amber"
                    testId="provider-plan-growth-stat-expiring-7d"
                  />
                  <StatCard
                    label="Expired, needs review"
                    value={data.expiring.expiredButNotActivated.toLocaleString(
                      "en-IN"
                    )}
                    tone={
                      data.expiring.expiredButNotActivated > 0 ? "rose" : "slate"
                    }
                    testId="provider-plan-growth-stat-expired-not-activated"
                  />
                </div>
              </div>

              {/* Breakdown table */}
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-800">
                  Breakdown
                </p>
                <div className="overflow-x-auto rounded-xl border border-slate-200">
                  <table
                    data-testid="provider-plan-growth-breakdown-table"
                    className="min-w-full text-left text-xs"
                  >
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Plan</th>
                        <th className="px-3 py-2 font-semibold">Active</th>
                        <th className="px-3 py-2 font-semibold">
                          Scheduled next cycle
                        </th>
                        <th className="px-3 py-2 font-semibold">
                          Per-cycle revenue
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      <tr className="bg-white">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          Free
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {data.totals.free.toLocaleString("en-IN")}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {data.scheduled.free.toLocaleString("en-IN")}
                        </td>
                        <td className="px-3 py-2 text-slate-400">—</td>
                      </tr>
                      <tr className="bg-white">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          ₹31 / 5 Regions
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {data.totals.regions5.toLocaleString("en-IN")}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {data.scheduled.regions5.toLocaleString("en-IN")}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {formatINR(data.revenue.regions5Revenue)}
                        </td>
                      </tr>
                      <tr className="bg-white">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          ₹101 / Full Jodhpur
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {data.totals.allJodhpur.toLocaleString("en-IN")}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {data.scheduled.allJodhpur.toLocaleString("en-IN")}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {formatINR(data.revenue.allJodhpurRevenue)}
                        </td>
                      </tr>
                      <tr className="bg-white">
                        <td className="px-3 py-2 font-medium text-slate-800">
                          Expired paid
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {data.totals.expiredPaid.toLocaleString("en-IN")}
                        </td>
                        <td className="px-3 py-2 text-slate-400">—</td>
                        <td className="px-3 py-2 text-slate-400">—</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Notes / help block */}
              <div className="rounded-xl border border-slate-200 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setNotesOpen((v) => !v)}
                  aria-expanded={notesOpen}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-xs font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <span>What these numbers mean</span>
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-4 w-4 transition-transform ${
                      notesOpen ? "rotate-180" : "rotate-0"
                    }`}
                  />
                </button>
                {notesOpen ? (
                  <ul className="space-y-1 border-t border-slate-200 px-4 py-3 text-xs leading-relaxed text-slate-600">
                    {data.notes.map((note, i) => (
                      <li key={i} className="flex gap-2">
                        <span aria-hidden="true" className="mt-0.5 text-slate-400">
                          •
                        </span>
                        <span>{note}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
