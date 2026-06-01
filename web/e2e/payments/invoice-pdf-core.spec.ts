/**
 * Phase 3A: invoice PDF — pure-logic + renderer smoke spec.
 *
 * Runs in Node under the Playwright runner WITHOUT a dev server or DB.
 * Covers the only branching logic worth pinning (storage path, claim
 * rules, skip/regenerate, attempts) plus an end-to-end renderer smoke
 * test that produces real PDF bytes from a snapshot — no DB, no Storage.
 *
 * Pure core is imported via a relative path (no adminSupabase pulled in).
 */

import { test, expect } from "@playwright/test";

import {
  claimableStatuses,
  invoiceStoragePath,
  isRegeneration,
  nextAttempts,
  pdfContentDisposition,
  shouldSkipAsGenerated,
  type InvoiceItemRecord,
  type InvoiceRecord,
} from "../../lib/payments/invoicePdfCore";
import { renderInvoicePdf } from "../../lib/payments/invoicePdf";

test.describe("Phase 3A — invoice PDF core", () => {
  test("storage path: slashes in number become dashes", () => {
    expect(invoiceStoragePath("FY2026-27", "KK/FY2026-27/000001")).toBe(
      "FY2026-27/KK-FY2026-27-000001.pdf"
    );
  });

  test("claimable statuses exclude 'generating' (mutual exclusion)", () => {
    expect(claimableStatuses(false)).toEqual(["pending", "failed"]);
    expect(claimableStatuses(true)).toEqual(["pending", "failed", "generated"]);
    // 'generating' is never claimable — the claim must move OUT of the set.
    expect(claimableStatuses(true)).not.toContain("generating");
  });

  test("skip rules: generated skipped unless forced", () => {
    expect(shouldSkipAsGenerated("generated", false)).toBe(true);
    expect(shouldSkipAsGenerated("generated", true)).toBe(false);
    expect(shouldSkipAsGenerated("pending", false)).toBe(false);
    expect(shouldSkipAsGenerated("failed", false)).toBe(false);
  });

  test("regeneration only when forcing an already-generated invoice", () => {
    expect(isRegeneration("generated", true)).toBe(true);
    expect(isRegeneration("generated", false)).toBe(false);
    expect(isRegeneration("pending", true)).toBe(false);
  });

  test("attempts increment is defensive", () => {
    expect(nextAttempts(0)).toBe(1);
    expect(nextAttempts(2)).toBe(3);
    expect(nextAttempts(null)).toBe(1);
    expect(nextAttempts(undefined)).toBe(1);
    expect(nextAttempts(-5)).toBe(1);
  });

  test("content-disposition: inline view is bare 'inline' (no filename)", () => {
    // The filename param on an inline disposition is what makes some
    // browsers download instead of render — so View must be bare inline.
    expect(pdfContentDisposition("inline", "KK-FY2026-27-000001.pdf")).toBe(
      "inline"
    );
    expect(pdfContentDisposition(null, "KK-FY2026-27-000001.pdf")).toBe("inline");
    expect(pdfContentDisposition(undefined, "x.pdf")).toBe("inline");
    expect(pdfContentDisposition("anything-else", "x.pdf")).toBe("inline");
  });

  test("content-disposition: attachment keeps the filename", () => {
    expect(
      pdfContentDisposition("attachment", "KK-FY2026-27-000001.pdf")
    ).toBe('attachment; filename="KK-FY2026-27-000001.pdf"');
    // Header-injection / quote safety.
    expect(pdfContentDisposition("attachment", 'a"b\r\n.pdf')).toBe(
      'attachment; filename="ab.pdf"'
    );
    expect(pdfContentDisposition("attachment", "")).toBe(
      'attachment; filename="invoice.pdf"'
    );
  });
});

// A snapshot matching the verified live invoice KK/FY2026-27/000001
// (all_jodhpur, total 11918 paise; intra-state Rajasthan → CGST+SGST).
function liveInvoice(overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 1,
    invoice_number: "KK/FY2026-27/000001",
    financial_year: "FY2026-27",
    invoice_date: "2026-06-01",
    service_period_start: "2026-06-01T00:00:00+05:30",
    service_period_end: "2026-07-01T00:00:00+05:30",
    seller_gstin: "08BYPHR6399K2ZD",
    seller_legal_name: "Rishabh Rathi",
    seller_trade_name: "KAUN KAREGA",
    seller_address:
      "116, Gopi Kishan Vihar, Guru Ka Talab, Pratap Nagar, Jodhpur, Rajasthan - 342003",
    seller_state_code: "08",
    buyer_name: "PR-3131 Provider",
    buyer_phone: "9999999999",
    buyer_gstin: null,
    buyer_state_code: "08",
    place_of_supply: "08-Rajasthan",
    supply_type: "intra",
    currency: "INR",
    taxable_value_paise: 10100,
    cgst_bps: 900,
    sgst_bps: 900,
    igst_bps: 0,
    cgst_paise: 909,
    sgst_paise: 909,
    igst_paise: 0,
    total_tax_paise: 1818,
    total_paise: 11918,
    pdf_status: "pending",
    pdf_attempts: 0,
    ...overrides,
  };
}

function liveItems(): InvoiceItemRecord[] {
  return [
    {
      line_no: 1,
      description: "Kaun Karega Provider Listing Plan - Full Jodhpur",
      sac_code: "998399",
      quantity: 1,
      unit_price_paise: 10100,
      taxable_value_paise: 10100,
      gst_bps: 1800,
      cgst_paise: 909,
      sgst_paise: 909,
      igst_paise: 0,
      line_total_paise: 11918,
    },
  ];
}

test.describe("Phase 3A — invoice PDF renderer (smoke)", () => {
  test("renders a non-trivial PDF for an intra-state invoice", () => {
    const bytes = renderInvoicePdf(liveInvoice(), liveItems());
    expect(bytes).toBeInstanceOf(Uint8Array);
    // Valid PDF header "%PDF".
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
    // A real one-page invoice is comfortably over 1 KB.
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  test("renders for an unregistered buyer and an inter-state invoice", () => {
    const inter = liveInvoice({
      buyer_gstin: null,
      buyer_state_code: "07",
      place_of_supply: "07-Delhi",
      supply_type: "inter",
      cgst_bps: 0,
      sgst_bps: 0,
      igst_bps: 1800,
      cgst_paise: 0,
      sgst_paise: 0,
      igst_paise: 1818,
    });
    const bytes = renderInvoicePdf(inter, liveItems());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x25, 0x50, 0x44, 0x46]);
  });
});
