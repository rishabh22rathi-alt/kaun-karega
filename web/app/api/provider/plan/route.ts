import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";
import { effectivePlan } from "@/lib/payments/effectivePlan";
import {
  getPlanRule,
  MONTHLY_CHANGE_LIMIT,
  type ChangeType,
} from "@/lib/payments/planRules";

// Lightweight provider-plan endpoint. Called by the register page on
// mount so it can derive the region cap and remaining monthly changes
// without loading the heavy dashboard-profile payload.
//
// Response shape:
//   { ok: true,
//     plan: { code, maxRegions, currentPeriodEnd, active, ruleKind },
//     remaining: { region_change: N, category_change: N },
//     monthlyLimit: 3 }
//
// "remaining" reflects how many MORE changes of each kind the provider
// can make in the current calendar month. Computed by counting log rows
// since the start of the current month and subtracting from the limit.
// First-time registration is NOT a logged change; the inserted log row
// only appears on EDIT saves that mutate the field.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizePhone10(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  const phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

function monthStartIso(now: Date = new Date()): string {
  // First-of-month at midnight UTC. SQL count uses >= this value.
  // Calendar-month semantics keep the UX predictable: the counter
  // resets at 00:00 on the 1st regardless of timezone (server-side
  // timezone could vary across deploys; UTC is the safe anchor).
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  return d.toISOString();
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

  // Plan row + monthly change counts in parallel. Failure on either
  // side falls back to safe defaults so the register page never hangs.
  const monthStart = monthStartIso();
  const [planResult, regionCountResult, categoryCountResult] = await Promise.all([
    adminSupabase
      .from("provider_plans")
      .select("plan_code, max_regions, current_period_start, current_period_end")
      .eq("provider_id", providerId)
      .maybeSingle(),
    adminSupabase
      .from("provider_change_log")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", providerId)
      .eq("change_type", "region_change" satisfies ChangeType)
      .gte("changed_at", monthStart),
    adminSupabase
      .from("provider_change_log")
      .select("id", { count: "exact", head: true })
      .eq("provider_id", providerId)
      .eq("change_type", "category_change" satisfies ChangeType)
      .gte("changed_at", monthStart),
  ]);

  const plan = effectivePlan(planResult.data ?? null);
  const rule = getPlanRule(plan.code);

  // Remaining = max(0, limit - count). The count read errors are
  // treated as "0 logged this month" so a transient DB blip doesn't
  // falsely lock the provider out of editing.
  const regionUsed = Number.isFinite(regionCountResult.count)
    ? Number(regionCountResult.count)
    : 0;
  const categoryUsed = Number.isFinite(categoryCountResult.count)
    ? Number(categoryCountResult.count)
    : 0;

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
      region_change: Math.max(0, MONTHLY_CHANGE_LIMIT - regionUsed),
      category_change: Math.max(0, MONTHLY_CHANGE_LIMIT - categoryUsed),
    },
    monthlyLimit: MONTHLY_CHANGE_LIMIT,
  });
}
