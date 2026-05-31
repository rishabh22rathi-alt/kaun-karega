import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { reconcileProviderCoverage } from "@/lib/admin/reconcileProviderCoverage";
import { invalidateSnapshots } from "@/lib/admin/snapshotCache";

/**
 * Admin-triggered provider coverage repair (Plan B).
 *
 * POST — requireAdminSession. Optional JSON body { providerId?: string }:
 *   - providerId present → reconcile just that provider.
 *   - absent             → reconcile every provider with a provider_plans row.
 *
 * Thin auth + JSON shell over reconcileProviderCoverage(); that helper owns
 * the logic and never throws (top-level failures come back as scanError).
 * Mirrors the auth/shape of /api/admin/provider-plans/activate-scheduled.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function unauthorized(): NextResponse {
  return NextResponse.json(
    { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
    { status: 401 }
  );
}

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return unauthorized();
  }

  let providerId: string | undefined;
  try {
    const body = (await request.json().catch(() => null)) as
      | { providerId?: unknown }
      | null;
    const raw = typeof body?.providerId === "string" ? body.providerId.trim() : "";
    providerId = raw || undefined;
  } catch {
    providerId = undefined;
  }

  const result = await reconcileProviderCoverage(providerId);

  if (!result.ok && result.scanError) {
    return NextResponse.json(
      { ok: false, error: result.scanError.code, message: result.scanError.message },
      { status: 500 }
    );
  }

  // Coverage changes feed the per-region provider counts and growth board.
  // Soft-fail: a cache miss must never turn a successful repair into a 5xx.
  if (result.fixed > 0) {
    try {
      await invalidateSnapshots(["provider_stats", "provider_plan_growth"]);
    } catch (err) {
      console.warn(
        "[admin/provider-coverage/rebuild] snapshot invalidation failed (non-fatal)",
        err instanceof Error ? err.message : err
      );
    }
  }

  return NextResponse.json({
    ok: true,
    checked: result.checked,
    fixed: result.fixed,
    warnings: result.warnings,
    errors: result.errors,
  });
}
