"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";

import { formatPaiseToRupees } from "@/lib/payments/gst";

/**
 * Admin dashboard tab — GST Invoices.
 *
 * Lists issued invoices and drives PDF generation/download via the
 * EXISTING routes (this tab adds no new generation logic):
 *   - list:      GET  /api/admin/invoices
 *   - generate:  POST /api/admin/invoices/pdf  { invoice_id } | {}  (bulk)
 *   - download:  GET  /api/admin/invoices/[id]/download
 *
 * Follows the ScheduledPlansTab accordion pattern: collapsed by default,
 * data loaded only when the section opens, button-triggered POSTs with a
 * confirmation prompt and in-flight disabling, and a re-fetch after every
 * action so the table never shows stale pdf_status. A "Last refreshed"
 * timestamp + explicit Refresh button make staleness visible.
 */

type Props = {
  defaultOpen?: boolean;
};

type InvoiceRow = {
  id: number;
  invoice_number: string;
  provider_id: string;
  buyer_name: string | null;
  buyer_phone: string | null;
  plan_code: string;
  invoice_date: string;
  issued_at: string;
  taxable_value_paise: number;
  total_tax_paise: number;
  total_paise: number;
  pdf_status: "pending" | "generating" | "generated" | "failed";
  pdf_last_error: string | null;
  pdf_storage_path: string | null;
  pdf_generated_at: string | null;
  pdf_attempts: number;
};

type ListResponse = {
  ok?: boolean;
  invoices?: InvoiceRow[];
  fetchedAt?: string;
  error?: string;
  message?: string;
};

type GenerateResponse = {
  ok?: boolean;
  rendered?: number;
  skipped?: number;
  failed?: number;
  error?: string;
  message?: string;
};

const PLAN_LABEL: Record<string, string> = {
  regions_5: "5 Regions",
  all_jodhpur: "Full Jodhpur",
};

const STATUS_PILL: Record<string, string> = {
  generated: "bg-emerald-100 text-emerald-800 border-emerald-300",
  generating: "bg-amber-100 text-amber-800 border-amber-300",
  pending: "bg-slate-100 text-slate-700 border-slate-300",
  failed: "bg-rose-100 text-rose-800 border-rose-300",
};

function planLabel(code: string): string {
  return PLAN_LABEL[code] ?? code;
}

function money(paise: number): string {
  return `Rs. ${formatPaiseToRupees(paise)}`;
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) {
    // Plain YYYY-MM-DD (invoice_date) → DD-MM-YYYY without timezone shift.
    const d = String(value).slice(0, 10);
    const [y, m, day] = d.split("-");
    return y && m && day ? `${day}-${m}-${y}` : d;
  }
  try {
    return new Date(ts).toLocaleString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return new Date(ts).toISOString().slice(0, 10);
  }
}

function formatTime(value: string | null): string {
  if (!value) return "—";
  const ts = Date.parse(value);
  if (Number.isNaN(ts)) return "—";
  try {
    return new Date(ts).toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return new Date(ts).toISOString();
  }
}

export default function InvoicesTab({ defaultOpen = false }: Props) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  const [rows, setRows] = useState<InvoiceRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [bulkResult, setBulkResult] = useState<{
    rendered: number;
    skipped: number;
    failed: number;
  } | null>(null);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/admin/invoices", {
        method: "GET",
        credentials: "same-origin",
      });
      const data = (await res.json().catch(() => null)) as ListResponse | null;
      if (!res.ok || !data?.ok) {
        setLoadError(
          data?.message || data?.error || `Failed to load invoices (${res.status}).`
        );
        setRows([]);
        return;
      }
      setRows(Array.isArray(data.invoices) ? data.invoices : []);
      setFetchedAt(data.fetchedAt ?? new Date().toISOString());
    } catch {
      setLoadError("Network error while loading invoices.");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void fetchInvoices();
  }, [isOpen, fetchInvoices]);

  const generateOne = useCallback(
    async (invoice: InvoiceRow, force: boolean) => {
      if (busyId !== null || bulkRunning) return;
      if (typeof window !== "undefined") {
        const verb = force ? "Regenerate" : "Generate";
        const ok = window.confirm(
          `${verb} the PDF for ${invoice.invoice_number}?`
        );
        if (!ok) return;
      }
      setBusyId(invoice.id);
      setActionError(null);
      try {
        const res = await fetch("/api/admin/invoices/pdf", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoice_id: invoice.id, force }),
        });
        const data = (await res.json().catch(() => null)) as GenerateResponse | null;
        if (!res.ok || !data?.ok) {
          setActionError(
            data?.message ||
              data?.error ||
              `PDF generation failed (${res.status}).`
          );
          return;
        }
      } catch {
        setActionError("Network error while generating the PDF.");
      } finally {
        setBusyId(null);
        // Always re-fetch so the row's pdf_status reflects the outcome.
        void fetchInvoices();
      }
    },
    [busyId, bulkRunning, fetchInvoices]
  );

  const generateBulk = useCallback(async () => {
    if (bulkRunning || busyId !== null) return;
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Generate PDFs for ALL invoices that are not yet generated. Continue?"
      );
      if (!ok) return;
    }
    setBulkRunning(true);
    setActionError(null);
    setBulkResult(null);
    try {
      const res = await fetch("/api/admin/invoices/pdf", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json().catch(() => null)) as GenerateResponse | null;
      if (!res.ok || !data?.ok) {
        setActionError(
          data?.message || data?.error || `Bulk generation failed (${res.status}).`
        );
        return;
      }
      setBulkResult({
        rendered: Number(data.rendered ?? 0),
        skipped: Number(data.skipped ?? 0),
        failed: Number(data.failed ?? 0),
      });
    } catch {
      setActionError("Network error while generating PDFs.");
    } finally {
      setBulkRunning(false);
      void fetchInvoices();
    }
  }, [bulkRunning, busyId, fetchInvoices]);

  const anyBusy = bulkRunning || busyId !== null;

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="invoices-tab-body"
        data-testid="invoices-tab-toggle"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">GST Invoices</p>
          <p className="mt-0.5 text-xs text-slate-500">
            List issued invoices, generate and download their GST PDFs.
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
          id="invoices-tab-body"
          data-testid="invoices-tab-body"
          className="space-y-4 border-t border-slate-200 px-5 py-5"
        >
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void fetchInvoices()}
              disabled={loading || anyBusy}
              data-testid="invoices-refresh-button"
              className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            <button
              type="button"
              onClick={() => void generateBulk()}
              disabled={anyBusy || loading}
              data-testid="invoices-bulk-generate-button"
              className="inline-flex items-center justify-center rounded-xl bg-[#003d20] px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {bulkRunning ? "Generating…" : "Generate pending PDFs"}
            </button>
            <span
              data-testid="invoices-last-refreshed"
              className="text-xs text-slate-500"
            >
              {fetchedAt ? `Last refreshed ${formatTime(fetchedAt)}` : "Not loaded yet"}
            </span>
          </div>

          {bulkResult ? (
            <div
              role="status"
              data-testid="invoices-bulk-result"
              className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
            >
              Generated {bulkResult.rendered} · skipped {bulkResult.skipped} ·
              failed {bulkResult.failed}.
            </div>
          ) : null}

          {actionError ? (
            <div
              role="alert"
              data-testid="invoices-action-error"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {actionError}
            </div>
          ) : null}

          {loadError ? (
            <div
              role="alert"
              data-testid="invoices-load-error"
              className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
            >
              {loadError}
            </div>
          ) : null}

          {rows === null ? (
            <p className="text-sm text-slate-500">Loading invoices…</p>
          ) : rows.length === 0 && !loadError ? (
            <p
              data-testid="invoices-empty"
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500"
            >
              No invoices yet.
            </p>
          ) : (
            <ul data-testid="invoices-list" className="space-y-3">
              {rows.map((inv) => {
                const isGenerated = inv.pdf_status === "generated";
                const isGenerating = inv.pdf_status === "generating";
                const isFailed = inv.pdf_status === "failed";
                const rowBusy = busyId === inv.id;
                return (
                  <li
                    key={inv.id}
                    data-testid={`invoice-row-${inv.id}`}
                    className="rounded-xl border border-slate-200 bg-white p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-slate-900">
                            {inv.invoice_number}
                          </span>
                          <span
                            data-testid={`invoice-status-${inv.id}`}
                            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              STATUS_PILL[inv.pdf_status] ??
                              "border-slate-300 bg-slate-50 text-slate-600"
                            }`}
                          >
                            {inv.pdf_status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          {formatDate(inv.invoice_date)} · {planLabel(inv.plan_code)}
                        </p>
                        <p className="text-xs text-slate-500">
                          <span className="font-mono">{inv.provider_id}</span>
                          {inv.buyer_name ? ` · ${inv.buyer_name}` : ""}
                          {inv.buyer_phone ? ` · ${inv.buyer_phone}` : ""}
                        </p>
                      </div>

                      <div className="flex shrink-0 flex-col items-end gap-2">
                        {isGenerated ? (
                          <div className="flex items-center gap-2">
                            <a
                              data-testid={`invoice-download-${inv.id}`}
                              href={`/api/admin/invoices/${inv.id}/download`}
                              className="inline-flex items-center justify-center rounded-lg bg-[#003d20] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#002a16]"
                            >
                              Download
                            </a>
                            <button
                              type="button"
                              onClick={() => void generateOne(inv, true)}
                              disabled={anyBusy}
                              data-testid={`invoice-generate-${inv.id}`}
                              className="inline-flex items-center justify-center rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {rowBusy ? "Working…" : "Regenerate"}
                            </button>
                          </div>
                        ) : isGenerating ? (
                          <span className="text-xs font-semibold text-amber-700">
                            Generating…
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void generateOne(inv, false)}
                            disabled={anyBusy}
                            data-testid={`invoice-generate-${inv.id}`}
                            className="inline-flex items-center justify-center rounded-lg bg-[#003d20] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#002a16] disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {rowBusy
                              ? "Working…"
                              : isFailed
                                ? "Regenerate PDF"
                                : "Generate PDF"}
                          </button>
                        )}
                      </div>
                    </div>

                    <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                          Taxable
                        </dt>
                        <dd className="text-sm font-semibold text-slate-700">
                          {money(inv.taxable_value_paise)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                          GST
                        </dt>
                        <dd className="text-sm font-semibold text-slate-700">
                          {money(inv.total_tax_paise)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[10px] uppercase tracking-wide text-slate-400">
                          Total
                        </dt>
                        <dd className="text-sm font-bold text-[#003d20]">
                          {money(inv.total_paise)}
                        </dd>
                      </div>
                    </dl>

                    {isFailed && inv.pdf_last_error ? (
                      <p
                        data-testid={`invoice-error-${inv.id}`}
                        className="mt-3 break-all rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                      >
                        {inv.pdf_last_error}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
