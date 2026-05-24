import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import { effectivePlan } from "@/lib/payments/effectivePlan";
import { getPlanRule, MONTHLY_CHANGE_LIMIT } from "@/lib/payments/planRules";

// Lightweight provider-plan endpoint. Called by the register page on
// mount so it can derive the region cap without loading the heavy
// dashboard-profile payload.
//
// Response shape:
//   { ok: true,
//     plan: { code, maxRegions, currentPeriodEnd, active, ruleKind },
//     remaining: { region_change: 3, category_change: 3 },
//     monthlyLimit: 3 }
//
// MVP note: the per-period change throttle was removed. `remaining`
// and `monthlyLimit` are kept in the wire shape for backward
// compatibility and now always report the full allowance — the
// register-page hint that consumes them is hidden when remaining ===
// monthlyLimit, so existing clients render correctly without a code
// change there.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone10(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

export async function GET(request: Request) {
  const session = await getAuthSession({
    cookie: request.headers.get("cookie") ?? "",
  });
  const sessionPhone = normalizePhone10(String(session?.phone || ""));
  if (!session || !sessionPhone) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED_PROVIDER_SESSION" },
      { status: 401 }
    );
  }

  // Resolve provider_id from the session phone. The 91-prefixed legacy
  // form is unioned in case any old row stored the 12-digit value.
  const { data: providerRow } = await adminSupabase
    .from("providers")
    .select("provider_id")
    .or(`phone.eq.${sessionPhone},phone.eq.91${sessionPhone}`)
    .limit(1)
    .maybeSingle();

  // No provider row yet = pre-registration. Return the free-plan
  // defaults so the register page can render correct caps before the
  // very first save.
  if (!providerRow) {
    const planRow = null;
    const plan = effectivePlan(planRow);
    const rule = getPlanRule(plan.code);
    return NextResponse.json({
      ok: true,
      plan: {
        code: plan.code,
        maxRegions: plan.maxRegions,
        currentPeriodEnd: plan.currentPeriodEnd,
        active: plan.active,
        ruleKind: rule.kind,
      },
      remaining: {
        region_change: MONTHLY_CHANGE_LIMIT,
        category_change: MONTHLY_CHANGE_LIMIT,
      },
      monthlyLimit: MONTHLY_CHANGE_LIMIT,
    });
  }

  const providerId = String(providerRow.provider_id);

  // MVP: the per-period monthly change limit was removed. Providers
  // can change regions/categories any number of times within their
  // plan cap. We still return `remaining` + `monthlyLimit` on the wire
  // for backward compatibility — set to the limit constant so any
  // existing consumer renders "full allowance" (e.g. the register
  // page hides its "changes left this month" hint when remaining ===
  // limit). The provider_change_log read used to populate these is
  // intentionally skipped to keep the route fast.
  const planResult = await adminSupabase
    .from("provider_plans")
    .select("plan_code, max_regions, current_period_start, current_period_end")
    .eq("provider_id", providerId)
    .maybeSingle();

  const plan = effectivePlan(planResult.data ?? null);
  const rule = getPlanRule(plan.code);

  return NextResponse.json({
    ok: true,
    plan: {
      code: plan.code,
      maxRegions: plan.maxRegions,
      currentPeriodEnd: plan.currentPeriodEnd,
      active: plan.active,
      ruleKind: rule.kind,
    },
    remaining: {
      region_change: MONTHLY_CHANGE_LIMIT,
      category_change: MONTHLY_CHANGE_LIMIT,
    },
    monthlyLimit: MONTHLY_CHANGE_LIMIT,
  });
}
