import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import { normalizePhone10 } from "@/lib/phone";

/**
 * Admin Payment Support — live read-only lookup endpoint.
 *
 * GET /api/admin/payments/recent
 *
 * Used by the Payment Support accordion on /admin/dashboard. Backs the
 * "did this provider actually pay? what plan? when?" support workflow
 * that the aggregate Provider Plan Growth tab cannot answer (counts
 * only) and the Scheduled Plans tab does not cover (activation audit,
 * not payments).
 *
 * Auth: requireAdminSession (cookie + session-version validation).
 *       401 UNAUTHORIZED for any non-admin caller.
 *
 * Caching: NONE. Support staff need to see freshly-captured payments
 * within seconds — a 5-minute cache (as on growth-summary) would
 * defeat the purpose. The query is cheap (≤200 rows, indexed reads).
 * `dynamic = "force-dynamic"` + `revalidate = 0` guarantee no Next
 * data cache layer wraps this endpoint.
 *
 * Smart search via `?q=`:
 *   - "pay_…"        → exact match on payment_orders.razorpay_payment_id
 *   - "P-…"          → exact match on payment_orders.provider_id
 *   - digits         → normalized to last-10; provider_id resolved by
 *                      `providers.phone ILIKE '%<lastTen>'`. Tolerates
 *                      stored formats "+91XXXXXXXXXX", "91XXXXXXXXXX",
 *                      and bare 10-digit.
 *   - empty          → default view = most recent successful payments
 *                      (status='paid'). When a search is present, ALL
 *                      statuses are returned so support can see failed
 *                      attempts too — important for "I tried to pay
 *                      three times" diagnostics.
 *
 * Limit: default 50, max 200. Defensive cap on hostile/typo input.
 *
 * Response shape: `{ ok: true, rows: PaymentRow[] }` — keys defined by
 * `PaymentRow` below. raw_webhook is intentionally NOT included
 * (sensitive payload; surfaces should pull it via a separate
 * drill-down endpoint if/when we add one).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

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

function unauthorized(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: "UNAUTHORIZED",
      message: "Admin session required.",
    },
    { status: 401 }
  );
}

function serverError(error: string, message: string): NextResponse {
  return NextResponse.json(
    { ok: false, error, message },
    { status: 500 }
  );
}

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) return unauthorized();

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();

  const limitParam = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

  // Build base select. Order is paid_at desc with nulls last (so
  // 'created' and 'failed' rows sink) then created_at desc as a
  // tiebreaker for same-paid_at batches and for the no-paid-at rows
  // that bubble up only when a payment-id search hits a non-paid row.
  let query = adminSupabase
    .from("payment_orders")
    .select(
      "order_id, provider_id, plan_code, amount_paise, status, razorpay_payment_id, created_at, paid_at"
    );

  // Smart-search dispatch. Note: each branch may early-return if it
  // can prove the result set is empty before hitting the orders table
  // — that saves a round-trip on a no-match phone lookup.
  if (q) {
    if (q.startsWith("pay_")) {
      query = query.eq("razorpay_payment_id", q);
    } else if (q.startsWith("P-") || q.startsWith("p-")) {
      // Provider IDs are uppercase in the providers table — normalise
      // so a lowercased copy/paste still matches.
      const providerId = q.startsWith("p-") ? `P-${q.slice(2)}` : q;
      query = query.eq("provider_id", providerId);
    } else {
      const phoneDigits = normalizePhone10(q);
      if (phoneDigits.length === 0) {
        // q has no digits and didn't match a typed prefix — bail with
        // empty rather than scan all orders.
        return NextResponse.json({ ok: true, rows: [] });
      }
      const { data: providersByPhone, error: phoneErr } = await adminSupabase
        .from("providers")
        .select("provider_id")
        .ilike("phone", `%${phoneDigits}`);
      if (phoneErr) {
        return serverError("PROVIDER_LOOKUP_FAILED", phoneErr.message);
      }
      const ids = (providersByPhone ?? []).map(
        (row) => row.provider_id as string
      );
      if (ids.length === 0) {
        return NextResponse.json({ ok: true, rows: [] });
      }
      query = query.in("provider_id", ids);
    }
  } else {
    // Default view — only successful payments. Search variants above
    // intentionally skip this filter so admins can see failed and
    // created-but-not-paid rows when diagnosing a specific provider
    // or payment.
    query = query.eq("status", "paid");
  }

  const { data: orders, error: ordersErr } = await query
    .order("paid_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (ordersErr) {
    return serverError("ORDERS_READ_FAILED", ordersErr.message);
  }

  const orderRows = orders ?? [];
  if (orderRows.length === 0) {
    return NextResponse.json({ ok: true, rows: [] });
  }

  // Enrich with provider name/phone + current plan state. Two
  // parallel reads keyed by the distinct provider_ids in the order
  // page. payment_orders FKs providers; provider_plans is keyed on
  // provider_id but has no FK from payment_orders, so we hydrate in
  // code rather than via a PostgREST embed.
  const providerIds = Array.from(
    new Set(orderRows.map((row) => row.provider_id as string))
  );

  const [providersRes, plansRes] = await Promise.all([
    adminSupabase
      .from("providers")
      .select("provider_id, full_name, phone")
      .in("provider_id", providerIds),
    adminSupabase
      .from("provider_plans")
      .select(
        "provider_id, plan_code, current_period_end, scheduled_plan_code, scheduled_activates_at"
      )
      .in("provider_id", providerIds),
  ]);

  if (providersRes.error) {
    return serverError(
      "PROVIDERS_READ_FAILED",
      providersRes.error.message
    );
  }
  if (plansRes.error) {
    return serverError("PLANS_READ_FAILED", plansRes.error.message);
  }

  const providerById = new Map<
    string,
    { full_name: string | null; phone: string | null }
  >();
  for (const provider of providersRes.data ?? []) {
    providerById.set(provider.provider_id as string, {
      full_name: (provider.full_name as string | null) ?? null,
      phone: (provider.phone as string | null) ?? null,
    });
  }

  const planById = new Map<
    string,
    {
      plan_code: string | null;
      current_period_end: string | null;
      scheduled_plan_code: string | null;
      scheduled_activates_at: string | null;
    }
  >();
  for (const plan of plansRes.data ?? []) {
    planById.set(plan.provider_id as string, {
      plan_code: (plan.plan_code as string | null) ?? null,
      current_period_end: (plan.current_period_end as string | null) ?? null,
      scheduled_plan_code: (plan.scheduled_plan_code as string | null) ?? null,
      scheduled_activates_at:
        (plan.scheduled_activates_at as string | null) ?? null,
    });
  }

  const rows: PaymentRow[] = orderRows.map((order) => {
    const providerInfo = providerById.get(order.provider_id as string);
    const planInfo = planById.get(order.provider_id as string);
    return {
      order_id: order.order_id as string,
      provider_id: order.provider_id as string,
      provider_phone: providerInfo?.phone ?? null,
      provider_name: providerInfo?.full_name ?? null,
      plan_code: order.plan_code as string,
      amount_paise: order.amount_paise as number,
      status: order.status as string,
      razorpay_payment_id: (order.razorpay_payment_id as string | null) ?? null,
      created_at: order.created_at as string,
      paid_at: (order.paid_at as string | null) ?? null,
      current_plan_code: planInfo?.plan_code ?? null,
      current_period_end: planInfo?.current_period_end ?? null,
      scheduled_plan_code: planInfo?.scheduled_plan_code ?? null,
      scheduled_activates_at: planInfo?.scheduled_activates_at ?? null,
    };
  });

  return NextResponse.json({ ok: true, rows });
}
