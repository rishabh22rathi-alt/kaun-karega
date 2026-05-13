"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

// Reports accordion for /admin/dashboard.
//
// Reads:   GET /api/admin/reports?type=...&from=...&to=...
// Mutates: none — preview + downloadable PDF only.
//
// PDF generation runs entirely in the browser via jsPDF + autotable
// (added to web/package.json). No server-side PDF rendering, no file
// upload — the response that powered the on-screen preview is the
// same JSON used to lay out the PDF.

type ReportType =
  | "kaam_demand"
  | "provider_leads"
  | "system_health"
  | "monthly_business_summary";

type SummaryEntry = { label: string; value: string | number };

type ReportSection = {
  title: string;
  columns: string[];
  rows: Array<Record<string, string | number | null>>;
};

type ReportPayload = {
  success?: boolean;
  type?: ReportType;
  title?: string;
  from?: string;
  to?: string;
  generatedAt?: string;
  summary?: SummaryEntry[];
  sections?: ReportSection[];
  notes?: string[];
  error?: string;
};

const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  monthly_business_summary: "Monthly Business Summary",
  kaam_demand: "Kaam Demand",
  provider_leads: "Provider Leads",
  system_health: "System Health",
};

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  );
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(
      2,
      "0"
    )}-${String(d.getUTCDate()).padStart(2, "0")}`;
  return { from: fmt(first), to: fmt(now) };
}

export default function ReportsTab() {
  const [isOpen, setIsOpen] = useState(false);
  const [type, setType] = useState<ReportType>("monthly_business_summary");
  const initialRange = defaultRange();
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(): Promise<void> {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const params = new URLSearchParams({ type, from, to });
      const res = await fetch(`/api/admin/reports?${params.toString()}`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      const json = (await res.json().catch(() => ({}))) as ReportPayload;
      if (!res.ok || !json?.success) {
        setError(json?.error || `Failed (${res.status})`);
        return;
      }
      setReport(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadPdf(): Promise<void> {
    if (!report) return;
    setDownloading(true);
    try {
      // Dynamic-import jsPDF + autotable so the bundle stays light for
      // admins who never click the button.
      const { jsPDF } = await import("jspdf");
      const autoTableModule = await import("jspdf-autotable");
      const autoTable = (autoTableModule.default ??
        (autoTableModule as unknown as {
          default: typeof autoTableModule.default;
        }).default) as (
        doc: InstanceType<typeof jsPDF>,
        opts: Record<string, unknown>
      ) => void;

      const doc = new jsPDF({
        unit: "pt",
        format: "a4",
        orientation: "portrait",
      });
      const pageWidth = doc.internal.pageSize.getWidth();
      const marginX = 40;
      let cursorY = 50;

      // Header
      doc.setFontSize(18);
      doc.setTextColor("#003d20");
      doc.text("KAUN KAREGA", marginX, cursorY);
      cursorY += 18;
      doc.setFontSize(11);
      doc.setTextColor("#0f172a");
      doc.text("Management Report", marginX, cursorY);
      cursorY += 14;
      doc.setFontSize(13);
      doc.setTextColor("#003d20");
      doc.text(report.title ?? "Report", marginX, cursorY);
      cursorY += 16;
      doc.setFontSize(9);
      doc.setTextColor("#475569");
      doc.text(
        `Range: ${report.from ?? ""} → ${report.to ?? ""}`,
        marginX,
        cursorY
      );
      cursorY += 12;
      doc.text(
        `Generated at: ${report.generatedAt ?? new Date().toISOString()}`,
        marginX,
        cursorY
      );
      cursorY += 20;

      // Summary
      if (report.summary && report.summary.length > 0) {
        autoTable(doc, {
          startY: cursorY,
          head: [["Metric", "Value"]],
          body: report.summary.map((s) => [s.label, String(s.value)]),
          margin: { left: marginX, right: marginX },
          styles: { fontSize: 9 },
          headStyles: { fillColor: [0, 61, 32], textColor: 255 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
        });
        cursorY =
          ((doc as unknown as { lastAutoTable?: { finalY: number } })
            .lastAutoTable?.finalY ?? cursorY) + 20;
      }

      // Sections
      for (const section of report.sections ?? []) {
        if (cursorY > 740) {
          doc.addPage();
          cursorY = 50;
        }
        doc.setFontSize(12);
        doc.setTextColor("#003d20");
        doc.text(section.title, marginX, cursorY);
        cursorY += 12;
        autoTable(doc, {
          startY: cursorY,
          head: [section.columns],
          body: section.rows.map((row) =>
            section.columns.map((col) =>
              row[col] === null || row[col] === undefined
                ? "—"
                : String(row[col])
            )
          ),
          margin: { left: marginX, right: marginX },
          styles: { fontSize: 8, cellPadding: 4 },
          headStyles: { fillColor: [0, 61, 32], textColor: 255 },
          alternateRowStyles: { fillColor: [248, 250, 252] },
        });
        cursorY =
          ((doc as unknown as { lastAutoTable?: { finalY: number } })
            .lastAutoTable?.finalY ?? cursorY) + 16;
      }

      // Notes
      if (report.notes && report.notes.length > 0) {
        if (cursorY > 740) {
          doc.addPage();
          cursorY = 50;
        }
        doc.setFontSize(10);
        doc.setTextColor("#003d20");
        doc.text("Notes", marginX, cursorY);
        cursorY += 12;
        doc.setFontSize(9);
        doc.setTextColor("#475569");
        for (const note of report.notes) {
          const wrapped = doc.splitTextToSize(
            `• ${note}`,
            pageWidth - marginX * 2
          ) as string[];
          for (const line of wrapped) {
            doc.text(line, marginX, cursorY);
            cursorY += 12;
          }
        }
      }

      // Footer (per page)
      const totalPages = (doc as unknown as {
        internal: { getNumberOfPages: () => number };
      }).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setTextColor("#94a3b8");
        doc.text(
          `Page ${i} of ${totalPages}`,
          pageWidth - marginX,
          820,
          { align: "right" }
        );
        doc.text(
          "Generated from Kaun Karega Admin Dashboard",
          marginX,
          820
        );
      }

      const fileName = `kaun-karega-${report.type ?? "report"}-${report.from ?? from}-${report.to ?? to}.pdf`;
      doc.save(fileName);
    } catch (err) {
      setError(
        err instanceof Error
          ? `PDF export failed: ${err.message}`
          : "PDF export failed"
      );
    } finally {
      setDownloading(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        aria-controls="reports-tab-body"
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-slate-50"
      >
        <div className="min-w-0">
          <p className="text-base font-semibold text-slate-900">Reports</p>
          <p className="mt-0.5 text-xs text-slate-500">
            Generate PDF reports from Supabase data
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
        <div id="reports-tab-body" className="border-t border-slate-200 px-5 py-5">
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <label className="text-xs font-medium text-slate-700">
              Report Type
              <select
                value={type}
                onChange={(e) => setType(e.target.value as ReportType)}
                data-testid="reports-type-select"
                className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
              >
                {(
                  Object.entries(REPORT_TYPE_LABELS) as Array<
                    [ReportType, string]
                  >
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-slate-700">
              From
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                data-testid="reports-from-input"
                className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
              />
            </label>
            <label className="text-xs font-medium text-slate-700">
              To
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                data-testid="reports-to-input"
                className="ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleGenerate()}
              disabled={loading || !from || !to}
              data-testid="reports-generate"
              className="ml-auto inline-flex items-center rounded-lg bg-[#003d20] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#005533] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loading ? "Generating…" : "Generate Preview"}
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadPdf()}
              disabled={!report || downloading}
              data-testid="reports-download-pdf"
              className="inline-flex items-center rounded-lg border border-[#003d20] bg-white px-3 py-1.5 text-xs font-semibold text-[#003d20] transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {downloading ? "Preparing PDF…" : "Download PDF"}
            </button>
          </div>

          {error && (
            <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </p>
          )}

          {!report && !loading && !error && (
            <p
              data-testid="reports-empty"
              className="mt-4 rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-sm text-slate-500"
            >
              Choose a report type and date range, then click Generate
              Preview.
            </p>
          )}

          {report && (
            <div
              data-testid="reports-result"
              className="mt-4 space-y-4"
            >
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  {REPORT_TYPE_LABELS[report.type ?? "monthly_business_summary"]}
                </p>
                <p className="text-base font-bold text-slate-900">
                  {report.title}
                </p>
                <p className="mt-0.5 text-[11px] text-slate-500">
                  {report.from} → {report.to}
                </p>
              </div>

              {report.summary && report.summary.length > 0 && (
                <div
                  data-testid="reports-summary"
                  className="grid grid-cols-2 gap-2 md:grid-cols-3"
                >
                  {report.summary.map((s) => (
                    <div
                      key={s.label}
                      className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
                      data-testid={`reports-summary-${s.label}`}
                    >
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {s.label}
                      </p>
                      <p className="mt-0.5 text-sm font-bold text-slate-900">
                        {String(s.value)}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {(report.sections ?? []).map((section) => (
                <section
                  key={section.title}
                  data-testid={`reports-section-${section.title}`}
                  className="overflow-x-auto rounded-xl border border-slate-200"
                >
                  <p className="bg-slate-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                    {section.title}
                  </p>
                  <table className="min-w-full divide-y divide-slate-200 text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        {section.columns.map((col) => (
                          <th
                            key={col}
                            className="px-3 py-2 text-left font-semibold uppercase tracking-wide text-slate-600"
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {section.rows.length === 0 ? (
                        <tr>
                          <td
                            colSpan={section.columns.length}
                            className="px-3 py-3 text-center text-slate-500"
                          >
                            No rows.
                          </td>
                        </tr>
                      ) : (
                        section.rows.map((row, i) => (
                          <tr key={i}>
                            {section.columns.map((col) => (
                              <td
                                key={col}
                                className="px-3 py-1.5 text-slate-700"
                              >
                                {row[col] === null || row[col] === undefined
                                  ? "—"
                                  : String(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </section>
              ))}

              {report.notes && report.notes.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <p className="font-semibold uppercase tracking-wide">
                    Notes
                  </p>
                  <ul className="mt-1 list-disc pl-4">
                    {report.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
