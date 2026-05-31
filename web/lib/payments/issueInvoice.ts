import { adminSupabase } from "@/lib/supabase/admin";
import { isInvoiceLedgerEnabled } from "@/lib/payments/server";
import { runInvoiceIssuance } from "@/lib/payments/issueInvoiceCore";

/**
 * Phase 2: GST invoice issuance hook for the Razorpay webhook.
 *
 * The webhook is PAYMENT-FIRST: this is called AFTER payment_orders.status
 * is flipped to 'paid', and it MUST soft-fail — a failure here can never
 * break paid-plan activation or trigger a Razorpay retry on an already-paid
 * order. All the real work (atomic, idempotent, gap-free numbering) lives in
 * the DB function issue_invoice_for_paid_order; the pure decision/normalise
 * logic lives in issueInvoiceCore (so it is unit-testable without a client).
 *
 * No PDF is generated here (the function leaves pdf_status='pending').
 */
export async function safeIssueInvoiceForPaidOrder(orderId: string): Promise<void> {
  await runInvoiceIssuance(orderId, {
    enabled: isInvoiceLedgerEnabled(),
    rpc: async (id) => {
      const { data, error } = await adminSupabase.rpc(
        "issue_invoice_for_paid_order",
        { p_order_id: id }
      );
      return { data, error: error ? { message: error.message } : null };
    },
  });
}
