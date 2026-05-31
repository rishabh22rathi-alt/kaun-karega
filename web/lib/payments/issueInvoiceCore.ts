/**
 * Phase 2: pure issuance core (no DB/client imports → unit-testable).
 *
 * The real work — atomic, idempotent, gap-free numbering — lives in the DB
 * function issue_invoice_for_paid_order. This core only decides whether to
 * call it (feature flag) and normalises the result into a best-effort
 * outcome that NEVER throws, so the webhook stays payment-first.
 */

// Shape of the jsonb returned by issue_invoice_for_paid_order.
export type IssueInvoiceResult = {
  ok?: boolean;
  outcome?: "issued" | "exists" | "skipped" | "failed";
  invoice_id?: number;
  invoice_number?: string;
  total_paise?: number;
  error_code?: string;
};

// Minimal RPC port so the core is testable without a live DB / client.
export type InvoiceIssueRpc = (
  orderId: string
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type IssueOutcome = {
  attempted: boolean;
  ok: boolean;
  outcome?: string;
};

/**
 * Pure issuance core. NEVER throws — a thrown rpc, an rpc error, or a
 * non-success DB outcome all resolve to `{ ok: false }`.
 *
 * - flag off            → { attempted: false, ok: true }  (no rpc call)
 * - rpc outcome issued  → { attempted: true,  ok: true }
 * - rpc outcome exists  → { attempted: true,  ok: true }  (idempotent = success)
 * - rpc error / throw /
 *   skipped / failed    → { attempted: true,  ok: false }
 */
export async function runInvoiceIssuance(
  orderId: string,
  opts: { enabled: boolean; rpc: InvoiceIssueRpc }
): Promise<IssueOutcome> {
  if (!opts.enabled) {
    return { attempted: false, ok: true };
  }
  try {
    const { data, error } = await opts.rpc(orderId);
    if (error) {
      console.warn("[payments/invoice] issuance rpc error (non-fatal)", {
        orderId,
        error: error.message,
      });
      return { attempted: true, ok: false };
    }
    const result = (data ?? {}) as IssueInvoiceResult;
    const outcome = result.outcome;
    const ok = outcome === "issued" || outcome === "exists";
    if (!ok) {
      console.warn("[payments/invoice] issuance non-success outcome (non-fatal)", {
        orderId,
        outcome,
        errorCode: result.error_code,
      });
    }
    return { attempted: true, ok, outcome };
  } catch (err) {
    console.warn("[payments/invoice] issuance threw (non-fatal)", {
      orderId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { attempted: true, ok: false };
  }
}
