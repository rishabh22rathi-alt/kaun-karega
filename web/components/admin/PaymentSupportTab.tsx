"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Search } from "lucide-react";

/**
 * Admin dashboard tab — Payment Support.
 *
 * Live row-level lookup over payment_orders. Sits between the
 * aggregate ProviderPlanGrowthTab and the activation-runner
 * ScheduledPlansTab so support staff can quickly answer
 * "did this provider pay? what plan? when?" without dropping into
 * the database directly.
 *
 * Freshness: this tab MUST NOT be cached. The backing endpoint is
 * dynamic=force-dynamic / revalidate=0; the helper copy nudges
 * users that the aggregate counts above may lag while this lookup
 * is real-time.
 *
 * Layout follows ProviderPlanGrowthTab / ScheduledPlansTab —
 * collapsed by default, fetches once on first open, manual Refresh
 * button.
 */

type PaymentRow = {
  order_id: string;
  provider_id: string;
  provider_phone: string | null;
  provider_name: string | null;
  plan_code: string;
  amount_paise: number;
  status: string;
  razorpay_payment_id: string | null;
  created_at: string;
  paid_at: string | null;
  current_plan_code: string | null;
  current_period_end: string | null;
  scheduled_plan_code: string | null;
  scheduled_activates_at: string | null;
};

type ApiResponse = {
  ok?: boolean;
  rows?: PaymentRow[];
  error?: string;
  message?: string;
};

function formatDate(value: string | null): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "—";
  try {
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

function formatRupees(paise: number | null | undefined): string {
  if (!Number.isFinite(paise as number)) return "—";
  const rupees = Math.round((paise as number) / 100);
  return `₹${rupees.toLocaleString("en-IN")}`;
}

const PLAN_LABELS: Record<string, string> = {
  free: "Free",
  regions_5: "₹31 / 5 Regions",
  all_jodhpur: "₹101 / Full Jodhpur",
};

function formatPlan(code: string | null | undefined): string {
  if (!code) return "—";
  return PLAN_LABELS[code] ?? code;
}

const STATUS_PILL: Record<string, string> = {
  paid: "border-emerald-300 bg-emerald-50 text-emerald-800",
  failed: "border-rose-300 bg-rose-50 text-rose-800",
  created: "border-slate-300 bg-slate-50 text-slate-700",
};

function statusPill(status: string): string {
  return (
    STATUS_PILL[status] ?? "border-slate-300 bg-slate-100 text-slate-700"
  );
}

export default function PaymentSupportTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<PaymentRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  // Latest-request guard — drops responses from races where the user
  // changed the search before the previous fetch resolved.
  const requestIdRef = useRef(0);

  const fetchRows = useCallback(async (q: string) => {
    const myRequestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setActiveQuery(q);
    const url = q
      ? `/api/admin/payments/recent?q=${encodeURIComponent(q)}`
      : "/api/admin/payments/recent";
    try {
      const res = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await res.json().catch(() => null)) as ApiResponse | null;
      if (requestIdRef.current !== myRequestId) return;
      if (!res.ok || !body?.ok || !Array.isArray(body.rows)) {
        setError(
          body?.message ||
            body?.error ||
            `Failed to load payments (${res.status}).`
        );
        setRows([]);
        return;
      }
      setRows(body.rows);
    } catch {
      if (requestIdRef.current !== myRequestId) return;
      setError("Network error while loading payments.");
      setRows([]);
    } finally {
      if (requestIdRef.current === myRequestId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    if (rows !== null || loading) return;
    void fetchRows("");
  }, [isOpen, rows, loading, fetchRows]);

  const handleSearchSubmit = (
    event: React.FormEvent<HTMLFormElement>
  ): void => {
    event.preventDefault();
    void fetchRows(query.trim());
  };

  const handleClear = (): void => {
    setQuery("");
    void fetchRows("");
  };

  const handleRefresh = (): void => {
    void fetchRows(activeQuery);
  };

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="payment-support-tab-body"
        data-testid="payment-support-tab-toggle"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">
            Payment Support
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Live row-level lookup of provider payments by phone, provider ID,
            or Razorpay payment ID.
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
          id="payment-support-tab-body"
          className="space-y-4 border-t border-slate-200 px-5 py-5"
        >
          <p
            data-testid="payment-support-helper"
            className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-800"
          >
            Aggregate plan counts may lag briefly. Use this live lookup for
            payment support.
          </p>

          <form
            onSubmit={handleSearchSubmit}
            className="flex flex-wrap items-center gap-2"
          >
            <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 focus-within:border-[#003d20]">
              <Search
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-slate-400"
              />
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by phone, provider ID (P-…) or Razorpay ID (pay_…)"
                data-testid="payment-support-search-input"
                aria-label="Search payments"
                className="flex-1 border-0 bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
            <button
              type="submit"
              data-testid="payment-support-search-submit"
              disabled={loading}
              className="inline-flex items-center justify-center rounded-xl bg-[#003d20] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Searching…" : "Search"}
            </button>
            {activeQuery ? (
              <button
                type="button"
                onClick={handleClear}
                data-testid="payment-support-clear"
                className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
              >
                Clear
              </button>
            ) : (
              <button
                type="button"
                onClick={handleRefresh}
                data-testid="payment-support-refresh"
                disabled={loading}
                className="inline-flex items-center justify-center rounded-xl border border-[#003d20] bg-white px-3 py-2 text-sm font-semibold text-[#003d20] transition hover:bg-[#003d20] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            )}
          </form>

          {error ? (
            <div
              role="alert"
              data-testid="payment-support-error"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {error}
            </div>
          ) : null}

          {rows === null && loading ? (
            <p
              data-testid="payment-support-loading"
              className="py-6 text-center text-sm text-slate-500"
            >
              Loading…
            </p>
          ) : null}

          {rows !== null && rows.length === 0 && !loading ? (
            <p
              data-testid="payment-support-empty"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-6 text-center text-sm text-slate-600"
            >
              No payments found.
              {activeQuery ? (
                <span className="block text-xs text-slate-500">
                  Searched for: <span className="font-mono">{activeQuery}</span>
                </span>
              ) : null}
            </p>
          ) : null}

          {rows && rows.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table
                data-testid="payment-support-table"
                className="min-w-full text-left text-xs"
              >
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Date</th>
                    <th className="px-3 py-2 font-semibold">Phone</th>
                    <th className="px-3 py-2 font-semibold">Provider</th>
                    <th className="px-3 py-2 font-semibold">Provider ID</th>
                    <th className="px-3 py-2 font-semibold">Plan</th>
                    <th className="px-3 py-2 font-semibold">Amount</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                    <th className="px-3 py-2 font-semibold">Razorpay ID</th>
                    <th className="px-3 py-2 font-semibold">
                      Current plan + expiry
                    </th>
                    <th className="px-3 py-2 font-semibold">Scheduled</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((row) => {
                    const dateLabel = formatDate(row.paid_at ?? row.created_at);
                    const scheduledLabel = row.scheduled_plan_code
                      ? `${formatPlan(row.scheduled_plan_code)} → ${formatDate(
                          row.scheduled_activates_at
                        )}`
                      : "—";
                    return (
                      <tr
                        key={row.order_id}
                        data-testid={`payment-support-row-${row.order_id}`}
                        className="bg-white hover:bg-slate-50"
                      >
                        <td className="px-3 py-2 text-slate-600">
                          {dateLabel}
                        </td>
                        <td
                          data-testid={`payment-support-cell-phone-${row.order_id}`}
                          className="px-3 py-2 font-mono text-slate-800"
                        >
                          {row.provider_phone ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-800">
                          {row.provider_name ?? "—"}
                        </td>
                        <td
                          data-testid={`payment-support-cell-provider-${row.order_id}`}
                          className="px-3 py-2 font-mono text-slate-700"
                        >
                          {row.provider_id}
                        </td>
                        <td
                          data-testid={`payment-support-cell-plan-${row.order_id}`}
                          className="px-3 py-2 text-slate-700"
                        >
                          {formatPlan(row.plan_code)}
                        </td>
                        <td
                          data-testid={`payment-support-cell-amount-${row.order_id}`}
                          className="px-3 py-2 font-semibold text-slate-900"
                        >
                          {formatRupees(row.amount_paise)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            data-testid={`payment-support-cell-status-${row.order_id}`}
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide ${statusPill(
                              row.status
                            )}`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td
                          data-testid={`payment-support-cell-razorpay-${row.order_id}`}
                          className="px-3 py-2 font-mono text-slate-700"
                        >
                          {row.razorpay_payment_id ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          <div>{formatPlan(row.current_plan_code)}</div>
                          <div className="text-[11px] text-slate-500">
                            {row.current_period_end
                              ? `expires ${formatDate(row.current_period_end)}`
                              : "no expiry"}
                          </div>
                        </td>
                        <td
                          data-testid={`payment-support-cell-scheduled-${row.order_id}`}
                          className="px-3 py-2 text-slate-700"
                        >
                          {row.scheduled_plan_code ? (
                            <span className="inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                              {scheduledLabel}
                            </span>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
