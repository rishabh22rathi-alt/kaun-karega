/**
 * QA helpers for the provider-approval reconciliation suite.
 *
 * These specs exercise the four approve/reject endpoints + the
 * reconcileProviderApprovalStatus helper end-to-end against a real
 * Supabase. They are gated behind `QA_HARNESS_RECONCILE=1` so they
 * never run as part of the default suite — opt-in only.
 *
 * Required env (in .env.local or shell):
 *   QA_HARNESS_RECONCILE=1
 *   NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt>
 *   AUTH_SESSION_SECRET=<the same secret the dev server uses>
 *
 * Safety:
 *   - Every test row is tagged with pledge_version = "QA_HARNESS_RECONCILE".
 *   - Cleanup deletes only rows matching that marker.
 *   - Phones use the prefix 9999900* so they cannot collide with real
 *     Indian-mobile starts.
 *   - Provider names use the prefix "ZZ_QA_RECONCILE_" so a quick eyeball
 *     of the admin UI surfaces test rows immediately.
 */

import type { APIRequestContext } from "@playwright/test";
import crypto from "crypto";

export const QA_HARNESS_FLAG = "QA_HARNESS_RECONCILE";
export const QA_PLEDGE_VERSION_MARKER = "QA_HARNESS_RECONCILE";
export const QA_NAME_PREFIX = "ZZ_QA_RECONCILE_";

export function isReconcileHarnessEnabled(): boolean {
  return process.env.QA_HARNESS_RECONCILE === "1";
}

function getSupabaseEnv(): { url: string; serviceKey: string } | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    "";
  if (!url || !serviceKey) return null;
  return { url, serviceKey };
}

function assertSupabaseEnv(): { url: string; serviceKey: string } {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error(
      "QA reconcile suite requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY"
    );
  }
  return env;
}

function supabaseHeaders(serviceKey: string): Record<string, string> {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}

/**
 * Build a signed kk_auth_session cookie value identical to what the
 * production server issues. Mirrors web/lib/auth.ts encoding.
 */
export function buildSignedAuthCookie(phone: string): string {
  const secret = process.env.AUTH_SESSION_SECRET || "";
  if (!secret || secret.length < 16) {
    throw new Error(
      "QA reconcile suite requires AUTH_SESSION_SECRET (>=16 chars)"
    );
  }
  const session = { phone, verified: true, createdAt: Date.now() };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

// ─── Supabase REST helpers (service-role) ───────────────────────────────────

type RestOptions = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  query?: string;
  body?: unknown;
  prefer?: string;
};

async function supabaseRest<T = unknown>(
  request: APIRequestContext,
  table: string,
  opts: RestOptions = {}
): Promise<T> {
  const env = assertSupabaseEnv();
  const method = opts.method || "GET";
  const url = `${env.url}/rest/v1/${table}${opts.query ? `?${opts.query}` : ""}`;
  const headers = supabaseHeaders(env.serviceKey);
  if (opts.prefer) headers.Prefer = opts.prefer;

  const response = await request.fetch(url, {
    method,
    headers,
    data: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!response.ok()) {
    const text = await response.text();
    throw new Error(
      `Supabase ${method} ${table} failed ${response.status()}: ${text}`
    );
  }
  if (method === "DELETE" || method === "PATCH") {
    try {
      return (await response.json()) as T;
    } catch {
      return [] as unknown as T;
    }
  }
  return (await response.json()) as T;
}

// ─── Provider seeding ──────────────────────────────────────────────────────

export type SeedProviderOpts = {
  phoneSuffix: number; // 3-digit suffix appended to 9999900
  name?: string;
  status?: "pending" | "active";
  verified?: "yes" | "no";
  duplicateNameReviewStatus?: string | null;
};

export type SeededProvider = {
  providerId: string;
  phone: string;
  name: string;
};

export async function seedDummyProvider(
  request: APIRequestContext,
  opts: SeedProviderOpts
): Promise<SeededProvider> {
  const phoneTail = String(opts.phoneSuffix).padStart(3, "0").slice(-3);
  const phone = `9999900${phoneTail}`;
  const name = opts.name || `${QA_NAME_PREFIX}${phoneTail}`;

  const inserted = await supabaseRest<Array<{ provider_id: string }>>(
    request,
    "providers",
    {
      method: "POST",
      body: [
        {
          full_name: name,
          phone,
          status: opts.status || "active",
          verified: opts.verified || "yes",
          duplicate_name_review_status: opts.duplicateNameReviewStatus ?? null,
          pledge_version: QA_PLEDGE_VERSION_MARKER,
          pledge_accepted_at: new Date().toISOString(),
        },
      ],
    }
  );
  const providerId = inserted[0]?.provider_id;
  if (!providerId) throw new Error("seedDummyProvider: no provider_id returned");
  return { providerId, phone, name };
}

export async function setProviderStatus(
  request: APIRequestContext,
  providerId: string,
  status: string
): Promise<void> {
  await supabaseRest(request, "providers", {
    method: "PATCH",
    query: `provider_id=eq.${encodeURIComponent(providerId)}`,
    body: { status },
  });
}

export async function readProvider(
  request: APIRequestContext,
  providerId: string
): Promise<{
  provider_id: string;
  status: string;
  verified: string;
  duplicate_name_review_status: string | null;
} | null> {
  const rows = await supabaseRest<
    Array<{
      provider_id: string;
      status: string;
      verified: string;
      duplicate_name_review_status: string | null;
    }>
  >(request, "providers", {
    query: `provider_id=eq.${encodeURIComponent(providerId)}&select=provider_id,status,verified,duplicate_name_review_status`,
  });
  return rows[0] ?? null;
}

// ─── Queue seeding ──────────────────────────────────────────────────────────

export async function seedPendingCategoryRequest(
  request: APIRequestContext,
  providerId: string,
  requestedCategory: string
): Promise<{ requestId: string }> {
  const inserted = await supabaseRest<Array<{ request_id: string }>>(
    request,
    "pending_category_requests",
    {
      method: "POST",
      body: [
        {
          provider_id: providerId,
          requested_category: requestedCategory,
          status: "pending",
        },
      ],
    }
  );
  return { requestId: inserted[0].request_id };
}

export async function seedPendingAlias(
  request: APIRequestContext,
  providerId: string,
  alias: string,
  canonicalCategory: string
): Promise<void> {
  await supabaseRest(request, "category_aliases", {
    method: "POST",
    body: [
      {
        alias,
        canonical_category: canonicalCategory,
        alias_type: "work_tag",
        active: false,
        submitted_by_provider_id: providerId,
      },
    ],
  });
}

export async function seedPendingAreaReview(
  request: APIRequestContext,
  providerId: string,
  rawArea: string
): Promise<{ reviewId: string }> {
  const inserted = await supabaseRest<Array<{ review_id: string }>>(
    request,
    "area_review_queue",
    {
      method: "POST",
      body: [
        {
          raw_area: rawArea,
          source_type: "provider_register",
          source_ref: providerId,
          status: "pending",
        },
      ],
    }
  );
  return { reviewId: inserted[0].review_id };
}

// ─── Cleanup ────────────────────────────────────────────────────────────────

/**
 * Marker-based cleanup. Removes:
 *   - providers with pledge_version = QA_HARNESS_RECONCILE
 *   - queue rows referencing those provider_ids
 *
 * Order matters: dependents first.
 */
export async function cleanupHarnessRows(
  request: APIRequestContext
): Promise<void> {
  // Fetch the set of harness providers first so we know which dependent
  // rows to remove.
  const rows = await supabaseRest<Array<{ provider_id: string }>>(
    request,
    "providers",
    {
      query: `pledge_version=eq.${encodeURIComponent(
        QA_PLEDGE_VERSION_MARKER
      )}&select=provider_id`,
    }
  );
  const ids = rows.map((r) => r.provider_id);
  if (ids.length === 0) return;

  const idList = ids.map((id) => `"${id}"`).join(",");
  const inFilter = `in.(${idList})`;

  // Best-effort dependents removal — ignore errors (some tables may not
  // have a row for every provider).
  for (const table of [
    "pending_category_requests",
    "category_aliases",
    "area_review_queue",
    "provider_services",
    "provider_areas",
    "provider_work_terms",
    "provider_plans",
  ]) {
    try {
      if (table === "category_aliases") {
        await supabaseRest(request, table, {
          method: "DELETE",
          query: `submitted_by_provider_id=${inFilter}`,
        });
      } else if (table === "area_review_queue") {
        await supabaseRest(request, table, {
          method: "DELETE",
          query: `source_ref=${inFilter}`,
        });
      } else {
        await supabaseRest(request, table, {
          method: "DELETE",
          query: `provider_id=${inFilter}`,
        });
      }
    } catch {
      // soft-fail; the marker-scoped DELETE below cleans up providers
    }
  }

  await supabaseRest(request, "providers", {
    method: "DELETE",
    query: `pledge_version=eq.${encodeURIComponent(
      QA_PLEDGE_VERSION_MARKER
    )}`,
  });
}

// ─── Admin endpoint call helpers ────────────────────────────────────────────

export type AdminCallResult = {
  status: number;
  body: Record<string, unknown>;
};

function adminCookieHeader(adminPhone: string): string {
  const cookie = buildSignedAuthCookie(adminPhone);
  return `kk_auth_session=${encodeURIComponent(cookie)}; kk_admin=1`;
}

export async function adminApproveCategoryRequest(
  request: APIRequestContext,
  baseURL: string,
  adminPhone: string,
  requestId: string,
  categoryName: string
): Promise<AdminCallResult> {
  const res = await request.post(`${baseURL}/api/kk`, {
    headers: { Cookie: adminCookieHeader(adminPhone) },
    data: {
      action: "approve_category_request",
      requestId,
      categoryName,
      AdminActorName: "QA Admin",
      AdminActorPhone: adminPhone,
      adminActionReason: "",
    },
  });
  return { status: res.status(), body: await res.json() };
}

export async function adminRejectCategoryRequest(
  request: APIRequestContext,
  baseURL: string,
  adminPhone: string,
  requestId: string,
  reason = "Rejected by QA"
): Promise<AdminCallResult> {
  const res = await request.post(`${baseURL}/api/kk`, {
    headers: { Cookie: adminCookieHeader(adminPhone) },
    data: {
      action: "reject_category_request",
      requestId,
      reason,
      AdminActorName: "QA Admin",
      AdminActorPhone: adminPhone,
    },
  });
  return { status: res.status(), body: await res.json() };
}

export async function adminApproveAlias(
  request: APIRequestContext,
  baseURL: string,
  adminPhone: string,
  alias: string
): Promise<AdminCallResult> {
  const res = await request.post(`${baseURL}/api/admin/aliases`, {
    headers: { Cookie: adminCookieHeader(adminPhone) },
    data: { action: "approve", alias },
  });
  return { status: res.status(), body: await res.json() };
}

export async function adminRejectAlias(
  request: APIRequestContext,
  baseURL: string,
  adminPhone: string,
  alias: string,
  reason = "Rejected by QA"
): Promise<AdminCallResult> {
  const res = await request.post(`${baseURL}/api/admin/aliases`, {
    headers: { Cookie: adminCookieHeader(adminPhone) },
    data: { action: "reject", alias, reason },
  });
  return { status: res.status(), body: await res.json() };
}

export async function adminResolveUnmappedArea(
  request: APIRequestContext,
  baseURL: string,
  adminPhone: string,
  reviewId: string
): Promise<AdminCallResult> {
  const res = await request.post(`${baseURL}/api/kk`, {
    headers: { Cookie: adminCookieHeader(adminPhone) },
    data: {
      action: "admin_resolve_unmapped_area",
      reviewId,
      resolvedCanonicalArea: "",
    },
  });
  return { status: res.status(), body: await res.json() };
}

export async function adminMapUnmappedArea(
  request: APIRequestContext,
  baseURL: string,
  adminPhone: string,
  reviewId: string,
  rawArea: string,
  canonicalArea: string
): Promise<AdminCallResult> {
  const res = await request.post(`${baseURL}/api/kk`, {
    headers: { Cookie: adminCookieHeader(adminPhone) },
    data: {
      action: "admin_map_unmapped_area",
      reviewId,
      rawArea,
      canonicalArea,
    },
  });
  return { status: res.status(), body: await res.json() };
}
