/**
 * Phase 3A: GST tax-invoice PDF renderer.
 *
 * Pure — input is the frozen invoice snapshot + its line items, output is
 * the PDF bytes. No DB, no Storage, no network. Renders ONLY the values
 * stored on the invoice; it NEVER recalculates GST or totals (the DB
 * function issue_invoice_for_paid_order is the sole source of those
 * numbers, and the invoice row is immutable for everything except pdf_*).
 *
 * Engine: jsPDF + jspdf-autotable (already dependencies; same A4 / brand
 * styling as the admin ReportsTab export). Runs headless in the Node
 * runtime and builds the document fully in memory (doc.output), so it
 * needs no writable filesystem — safe on Vercel serverless.
 *
 * Decision (Phase 3A): the rupee sign is NOT used — amounts render as
 * "Rs. 119.18" — so we stay on jsPDF's built-in Helvetica (WinAnsi) with
 * no Unicode font embedding.
 */

import { jsPDF } from "jspdf";
import autoTable, { type CellHookData } from "jspdf-autotable";

import { formatPaiseToRupees } from "@/lib/payments/gst";
import type {
  InvoiceItemRecord,
  InvoiceRecord,
} from "@/lib/payments/invoicePdfCore";

// Brand green, matching components/admin/ReportsTab.tsx.
const BRAND: [number, number, number] = [0, 61, 32];
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [71, 85, 105];

const MARGIN_X = 40;

/** "Rs. 1,234.56" — no ₹ glyph (Phase 3A decision). */
function money(paise: number): string {
  return `Rs. ${formatPaiseToRupees(paise)}`;
}

/** ISO date/timestamp → "DD-MM-YYYY" (date part only). */
function fmtDate(value: string): string {
  const datePart = String(value ?? "").slice(0, 10);
  const [y, m, d] = datePart.split("-");
  return y && m && d ? `${d}-${m}-${y}` : datePart;
}

/** basis points → percent label, e.g. 1800 → "18%", 900 → "9%". */
function pct(bps: number): string {
  return `${(Number(bps) || 0) / 100}%`;
}

function finalY(doc: jsPDF, fallback: number): number {
  const last = (doc as unknown as { lastAutoTable?: { finalY: number } })
    .lastAutoTable;
  return last?.finalY ?? fallback;
}

/** Two-column "label: value" block; returns the new cursor Y. */
function labelledBlock(
  doc: jsPDF,
  title: string,
  rows: Array<[string, string]>,
  x: number,
  startY: number,
  colWidth: number
): number {
  let y = startY;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(...BRAND);
  doc.text(title, x, y);
  y += 14;

  doc.setFontSize(9);
  for (const [label, value] of rows) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...MUTED);
    doc.text(label, x, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    const wrapped = doc.splitTextToSize(value || "—", colWidth - 96);
    doc.text(wrapped, x + 96, y);
    y += 12 * (Array.isArray(wrapped) ? wrapped.length : 1);
  }
  return y;
}

/**
 * Render the GST tax invoice. Returns the PDF as bytes ready to upload.
 */
export function renderInvoicePdf(
  invoice: InvoiceRecord,
  items: InvoiceItemRecord[]
): Uint8Array {
  const doc = new jsPDF({ unit: "pt", format: "a4", orientation: "portrait" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const rightX = pageWidth - MARGIN_X;
  const colWidth = (pageWidth - MARGIN_X * 2 - 20) / 2;
  let y = 48;

  // ── Header ────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...BRAND);
  doc.text("TAX INVOICE", MARGIN_X, y);

  doc.setFontSize(15);
  doc.text(invoice.seller_trade_name, rightX, y, { align: "right" });
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(invoice.seller_legal_name, rightX, y, { align: "right" });
  y += 20;

  doc.setDrawColor(...BRAND);
  doc.setLineWidth(1);
  doc.line(MARGIN_X, y, rightX, y);
  y += 18;

  // ── Seller (left) + Invoice meta (right), same baseline ───────────
  const blockTop = y;
  const leftEnd = labelledBlock(
    doc,
    "Seller",
    [
      ["Legal Name", invoice.seller_legal_name],
      ["Trade Name", invoice.seller_trade_name],
      ["GSTIN", invoice.seller_gstin],
      ["Address", invoice.seller_address],
      ["State Code", invoice.seller_state_code],
    ],
    MARGIN_X,
    blockTop,
    colWidth
  );

  const rightEnd = labelledBlock(
    doc,
    "Invoice Details",
    [
      ["Invoice No.", invoice.invoice_number],
      ["Invoice Date", fmtDate(invoice.invoice_date)],
      ["Place of Supply", invoice.place_of_supply],
      [
        "Supply Type",
        invoice.supply_type === "intra"
          ? "Intra-State (CGST + SGST)"
          : "Inter-State (IGST)",
      ],
      ["Reverse Charge", "No"],
    ],
    MARGIN_X + colWidth + 20,
    blockTop,
    colWidth
  );

  y = Math.max(leftEnd, rightEnd) + 10;

  // ── Buyer + Service period ────────────────────────────────────────
  const buyerEnd = labelledBlock(
    doc,
    "Buyer",
    [
      ["Name", invoice.buyer_name],
      ["Phone", invoice.buyer_phone],
      ["GSTIN", invoice.buyer_gstin ? invoice.buyer_gstin : "Unregistered"],
      ["State Code", invoice.buyer_state_code],
    ],
    MARGIN_X,
    y,
    colWidth
  );

  const periodEnd = labelledBlock(
    doc,
    "Service Period",
    [
      ["From", fmtDate(invoice.service_period_start)],
      ["To", fmtDate(invoice.service_period_end)],
    ],
    MARGIN_X + colWidth + 20,
    y,
    colWidth
  );

  y = Math.max(buyerEnd, periodEnd) + 12;

  // ── Line items ────────────────────────────────────────────────────
  autoTable(doc, {
    startY: y,
    head: [
      [
        "#",
        "Description",
        "SAC",
        "Taxable",
        "CGST",
        "SGST",
        "IGST",
        "Line Total",
      ],
    ],
    body: items.map((it) => [
      String(it.line_no),
      it.description,
      it.sac_code,
      money(it.taxable_value_paise),
      money(it.cgst_paise),
      money(it.sgst_paise),
      money(it.igst_paise),
      money(it.line_total_paise),
    ]),
    margin: { left: MARGIN_X, right: MARGIN_X },
    styles: { fontSize: 8, cellPadding: 4, textColor: INK },
    headStyles: { fillColor: BRAND, textColor: 255 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 18 },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
    },
  });
  y = finalY(doc, y) + 16;

  // ── Tax summary (right-aligned) ───────────────────────────────────
  const summaryRows: Array<[string, string]> = [
    ["Taxable Value", money(invoice.taxable_value_paise)],
    [`CGST (${pct(invoice.cgst_bps)})`, money(invoice.cgst_paise)],
    [`SGST (${pct(invoice.sgst_bps)})`, money(invoice.sgst_paise)],
    [`IGST (${pct(invoice.igst_bps)})`, money(invoice.igst_paise)],
    ["Total Tax", money(invoice.total_tax_paise)],
    ["Grand Total", money(invoice.total_paise)],
  ];

  autoTable(doc, {
    startY: y,
    body: summaryRows,
    margin: { left: pageWidth / 2, right: MARGIN_X },
    styles: { fontSize: 9, cellPadding: 4, textColor: INK },
    columnStyles: {
      0: { fontStyle: "bold", textColor: MUTED },
      1: { halign: "right" },
    },
    // Emphasise the grand-total row (last row).
    didParseCell: (data: CellHookData) => {
      if (data.row.index === summaryRows.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = BRAND;
        data.cell.styles.fontSize = 11;
      }
    },
  });
  y = finalY(doc, y) + 28;

  // ── Footer ────────────────────────────────────────────────────────
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y > pageHeight - 90) {
    doc.addPage();
    y = 60;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("This is a system-generated invoice.", MARGIN_X, y);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text(`For ${invoice.seller_trade_name}`, rightX, y, { align: "right" });
  y += 36;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text("Authorised Signatory", rightX, y, { align: "right" });

  const out = doc.output("arraybuffer");
  return new Uint8Array(out);
}
