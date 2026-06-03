/**
 * Read-only data-integrity invariants.
 *
 * Every function here performs SELECT-only queries — NEVER a write. This is
 * what makes "production read-only diagnostics" safe: the Operational Health
 * and Data Integrity packs both call these, and neither can mutate data.
 *
 * Scope:
 *   - "kktest" (default): only KKTEST provider ids — fast, deterministic,
 *     used after seeding to prove the fixtures are well-formed.
 *   - "all": platform-wide — used for production read-only health checks.
 *     Heavier; bounded by a LIMIT and aggregated in JS.
 *
 * Each check returns an IntegrityFinding. A thrown DB error is captured as a
 * failing finding rather than crashing the run, so one bad query never hides
 * the others.
 *
 * Query shape note: scope (`.in`) is applied at the FILTER stage, before
 * `.limit()` (the TRANSFORM stage), so the builder stays correctly typed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { IntegrityFinding } from "./report";
import { ALL_KKTEST_PROVIDER_IDS } from "./personas";

export type IntegrityScope = "kktest" | "all";

const SCAN_LIMIT = 5000;
const KK_IDS = ALL_KKTEST_PROVIDER_IDS as string[];

function planCap(planCode: string, maxRegions: number | null): number {
  if (typeof maxRegions === "number" && maxRegions > 0) return maxRegions;
  if (planCode === "all_jodhpur") return 99;
  if (planCode === "regions_5") return 5;
  return 1; // free / unknown
}

function isExpired(end: unknown, nowIso: string): boolean {
  const e = String(end ?? "").trim();
  return Boolean(e) && e < nowIso;
}

function asPid(row: unknown): string {
  return String((row as { provider_id?: unknown }).provider_id ?? "");
}

/**
 * Checks 1–4: provider_plans agrees with provider_areas (per-plan caps).
 * Free=1, regions_5≤5, all_jodhpur=all-active, expired→safe (1) cap.
 */
export async function checkPlanAreaAgreement(
  c: SupabaseClient,
  scope: IntegrityScope,
  nowIso: string
): Promise<IntegrityFinding[]> {
  const findings: IntegrityFinding[] = [];
  try {
    const planBase = c
      .from("provider_plans")
      .select("provider_id, plan_code, max_regions, current_period_end");
    const plans = await (scope === "kktest" ? planBase.in("provider_id", KK_IDS) : planBase).limit(SCAN_LIMIT);
    if (plans.error) throw new Error(plans.error.message);

    const areaBase = c.from("provider_areas").select("provider_id, region_code");
    const areas = await (scope === "kktest" ? areaBase.in("provider_id", KK_IDS) : areaBase).limit(SCAN_LIMIT);
    if (areas.error) throw new Error(areas.error.message);

    const regionsByProvider = new Map<string, Set<string>>();
    for (const a of areas.data ?? []) {
      const pid = asPid(a);
      const rc = String((a as { region_code?: unknown }).region_code ?? "").trim();
      if (!pid) continue;
      if (!regionsByProvider.has(pid)) regionsByProvider.set(pid, new Set());
      if (rc) regionsByProvider.get(pid)!.add(rc);
    }

    const overCap: string[] = [];
    for (const p of plans.data ?? []) {
      const pid = asPid(p);
      const code = String((p as { plan_code?: unknown }).plan_code ?? "free");
      const cap = planCap(code, (p as { max_regions?: number | null }).max_regions ?? null);
      const effCap = isExpired((p as { current_period_end?: unknown }).current_period_end, nowIso)
        ? 1
        : cap;
      const count = regionsByProvider.get(pid)?.size ?? 0;
      if (count > effCap) overCap.push(`${pid} (${code}: ${count} regions > cap ${effCap})`);
    }
    findings.push({
      check: "plan/area cap agreement (free=1, regions_5≤5, all_jodhpur, expired→1)",
      ok: overCap.length === 0,
      detail: overCap.length ? overCap.slice(0, 10).join("; ") : "all providers within effective cap",
    });
  } catch (err) {
    findings.push({
      check: "plan/area cap agreement",
      ok: false,
      detail: `query error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  return findings;
}

/** Check 5: an expired plan never carries all_jodhpur match priority. */
export async function checkExpiredNoCityWidePriority(
  c: SupabaseClient,
  scope: IntegrityScope,
  nowIso: string
): Promise<IntegrityFinding> {
  try {
    const planBase = c.from("provider_plans").select("provider_id, current_period_end");
    const plans = await (scope === "kktest" ? planBase.in("provider_id", KK_IDS) : planBase).limit(SCAN_LIMIT);
    if (plans.error) throw new Error(plans.error.message);

    const expired = new Set(
      (plans.data ?? [])
        .filter((p) => isExpired((p as { current_period_end?: unknown }).current_period_end, nowIso))
        .map(asPid)
    );
    if (expired.size === 0) {
      return { check: "expired plan has no city-wide match priority", ok: true, detail: "no expired plans in scope" };
    }

    const matchBase = c
      .from("provider_task_matches")
      .select("provider_id, match_scope")
      .eq("match_scope", "all_jodhpur");
    const matches = await (scope === "kktest" ? matchBase.in("provider_id", KK_IDS) : matchBase).limit(SCAN_LIMIT);
    if (matches.error) throw new Error(matches.error.message);

    const offenders = (matches.data ?? []).map(asPid).filter((pid) => expired.has(pid));
    return {
      check: "expired plan has no city-wide match priority",
      ok: offenders.length === 0,
      detail: offenders.length ? `offenders: ${[...new Set(offenders)].slice(0, 10).join(", ")}` : "clean",
    };
  } catch (err) {
    return {
      check: "expired plan has no city-wide match priority",
      ok: false,
      detail: `query error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Check 9: provider_task_matches has no duplicate (task_id, provider_id). */
export async function checkNoDuplicateMatches(
  c: SupabaseClient,
  scope: IntegrityScope
): Promise<IntegrityFinding> {
  try {
    const base = c.from("provider_task_matches").select("task_id, provider_id");
    const { data, error } = await (scope === "kktest" ? base.in("provider_id", KK_IDS) : base).limit(SCAN_LIMIT);
    if (error) throw new Error(error.message);

    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const m of data ?? []) {
      const key = `${(m as { task_id?: unknown }).task_id}::${asPid(m)}`;
      if (seen.has(key)) dups.add(key);
      seen.add(key);
    }
    return {
      check: "no duplicate provider_task_matches (task_id, provider_id)",
      ok: dups.size === 0,
      detail: dups.size ? `${dups.size} duplicate pair(s)` : "unique",
    };
  } catch (err) {
    return {
      check: "no duplicate provider_task_matches",
      ok: false,
      detail: `query error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * Checks 6–7: paid payment orders have an invoice; no orphan invoices.
 * Phase 1 ships the structure; assertions widen as the revenue pack lands.
 */
export async function checkPaymentInvoiceConsistency(
  c: SupabaseClient,
  scope: IntegrityScope
): Promise<IntegrityFinding[]> {
  const findings: IntegrityFinding[] = [];
  try {
    const orderBase = c.from("payment_orders").select("provider_id, status").eq("status", "paid");
    const orders = await (scope === "kktest" ? orderBase.in("provider_id", KK_IDS) : orderBase).limit(SCAN_LIMIT);
    if (orders.error) throw new Error(orders.error.message);

    const invoiceBase = c.from("invoices").select("provider_id");
    const invoices = await (scope === "kktest" ? invoiceBase.in("provider_id", KK_IDS) : invoiceBase).limit(SCAN_LIMIT);
    if (invoices.error) throw new Error(invoices.error.message);

    const invoiceProviders = new Set((invoices.data ?? []).map(asPid));
    const paidWithoutInvoice = (orders.data ?? [])
      .map(asPid)
      .filter((pid) => pid && !invoiceProviders.has(pid));

    findings.push({
      check: "every paid order has an invoice",
      ok: paidWithoutInvoice.length === 0,
      detail: paidWithoutInvoice.length
        ? `paid providers missing invoice: ${[...new Set(paidWithoutInvoice)].slice(0, 10).join(", ")}`
        : "consistent",
    });
  } catch (err) {
    findings.push({
      check: "payment/invoice consistency",
      ok: false,
      detail: `query error: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  return findings;
}

/** Runs the full read-only invariant set. */
export async function runIntegrityChecks(
  c: SupabaseClient,
  scope: IntegrityScope,
  nowIso: string
): Promise<IntegrityFinding[]> {
  const out: IntegrityFinding[] = [];
  out.push(...(await checkPlanAreaAgreement(c, scope, nowIso)));
  out.push(await checkExpiredNoCityWidePriority(c, scope, nowIso));
  out.push(await checkNoDuplicateMatches(c, scope));
  out.push(...(await checkPaymentInvoiceConsistency(c, scope)));
  return out;
}
