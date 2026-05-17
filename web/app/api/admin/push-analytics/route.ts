import { NextResponse, type NextRequest } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Phase 6 V1: read-only admin push-analytics endpoint.
//
// Single SELECT against push_logs with the smallest column set the UI
// needs, then in-memory aggregation. PostgREST has no GROUP BY, so the
// alternative would be N+M head:true count queries — fine for tiny
// tables, awkward to keep correct as the catalogue grows. The single-
// fetch path is simpler and bounded by ROW_FETCH_LIMIT below.
//
// Sensitive-data safety:
//   • fcm_token_tail   — NEVER selected (defense in depth, even though
//                        the column is already 8-char-tail-only)
//   • payload_json     — NEVER selected
//   • fcm_message_id   — NEVER selected (not useful at this surface)
//   • recipient_phone  — NEVER returned in recent_failures (admins can
//                        cross-reference recipient_provider_id with the
//                        Providers tab if they need a phone)
//
// The select list below is the only place these decisions are enforced;
// if you add a column to the SELECT, audit it against the list above.

const ALLOWED_RANGES = new Set(["today", "7d", "30d"] as const);
type AnalyticsRange = "today" | "7d" | "30d";

// Hard cap on rows pulled in a single request. With current push volume
// (~10s–100s/day) this is overkill, but stays correct as volume grows
// until we add a roll-up table. If a 30-day window ever returns >49,999
// rows the summary will under-count silently — at that point promote
// this surface to head:true counts + a materialized view.
const ROW_FETCH_LIMIT = 50_000;

// Maximum recent_failures rows surfaced to the UI. The route picks the
// first N non-sent rows from the time-ordered fetch.
const RECENT_FAILURES_LIMIT = 25;

function parseRange(raw: string | null): AnalyticsRange {
  const value = String(raw ?? "").trim().toLowerCase();
  return ALLOWED_RANGES.has(value as AnalyticsRange)
    ? (value as AnalyticsRange)
    : "7d";
}

function rangeSinceIso(range: AnalyticsRange): string {
  const now = new Date();
  if (range === "today") {
    const d = new Date(now);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const days = range === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

type PushLogRow = {
  created_at: string;
  event_type: string;
  status: string;
  error_code: string | null;
  error_message: string | null;
  recipient_provider_id: string | null;
};

type SummaryCounts = {
  sent: number;
  failed: number;
  invalid_token: number;
  preference_disabled: number;
  no_active_device: number;
  skipped_other: number;
  total: number;
};

type EventTypeBreakdown = {
  event_type: string;
  sent: number;
  failed: number;
  invalid_token: number;
  preference_disabled: number;
  no_active_device: number;
  skipped_other: number;
  total: number;
};

type RecentFailure = {
  created_at: string;
  event_type: string;
  status: string;
  reason: string; // semantic: error_message for skipped, error_code for failed/invalid_token
  recipient_provider_id: string | null;
};

function emptySummary(): SummaryCounts {
  return {
    sent: 0,
    failed: 0,
    invalid_token: 0,
    preference_disabled: 0,
    no_active_device: 0,
    skipped_other: 0,
    total: 0,
  };
}

function emptyEventBreakdown(event_type: string): EventTypeBreakdown {
  return {
    event_type,
    sent: 0,
    failed: 0,
    invalid_token: 0,
    preference_disabled: 0,
    no_active_device: 0,
    skipped_other: 0,
    total: 0,
  };
}

// Bucket a row into one of the six summary categories. 'skipped' has
// two semantic sub-reasons (preference_disabled, no_active_device) so
// we partition by error_message; everything else lands in skipped_other.
function bucketKey(row: PushLogRow): keyof Omit<SummaryCounts, "total"> {
  if (row.status === "sent") return "sent";
  if (row.status === "failed") return "failed";
  if (row.status === "invalid_token") return "invalid_token";
  if (row.status === "skipped") {
    if (row.error_message === "preference_disabled") {
      return "preference_disabled";
    }
    if (row.error_message === "no_active_device") {
      return "no_active_device";
    }
    return "skipped_other";
  }
  // Defensive: any future status value lands in skipped_other so the
  // total reconciliation stays honest.
  return "skipped_other";
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "UNAUTHORIZED", message: "Admin session required." },
      { status: 401 }
    );
  }

  const range = parseRange(request.nextUrl.searchParams.get("range"));
  const sinceIso = rangeSinceIso(range);

  // Explicit column list — the ONLY place column-level sensitive-data
  // decisions are made. Do not add columns to this select without
  // re-reading the safety notes at the top of this file.
  const { data, error } = await adminSupabase
    .from("push_logs")
    .select(
      "created_at, event_type, status, error_code, error_message, recipient_provider_id"
    )
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(ROW_FETCH_LIMIT);

  if (error) {
    console.error("[admin/push-analytics] push_logs fetch failed", {
      code: error.code,
      message: error.message,
      range,
    });
    return NextResponse.json(
      { ok: false, error: "DB_ERROR", message: "Could not load analytics." },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as PushLogRow[];
  const truncated = rows.length === ROW_FETCH_LIMIT;

  const summary = emptySummary();
  const byEventTypeMap = new Map<string, EventTypeBreakdown>();
  const recent_failures: RecentFailure[] = [];

  for (const row of rows) {
    const bucket = bucketKey(row);
    summary[bucket] += 1;
    summary.total += 1;

    const eventType = row.event_type || "unknown";
    const existing =
      byEventTypeMap.get(eventType) ?? emptyEventBreakdown(eventType);
    existing[bucket] += 1;
    existing.total += 1;
    byEventTypeMap.set(eventType, existing);

    if (row.status !== "sent" && recent_failures.length < RECENT_FAILURES_LIMIT) {
      // For skipped rows the human-meaningful reason lives in
      // error_message (preference_disabled / no_active_device). For
      // failed / invalid_token rows the FCM error_code is the most
      // useful field. Fall back to "—" so the UI never renders empty.
      const reason =
        row.status === "skipped"
          ? row.error_message || row.error_code || "—"
          : row.error_code || row.error_message || "—";
      recent_failures.push({
        created_at: row.created_at,
        event_type: eventType,
        status: row.status,
        reason,
        recipient_provider_id: row.recipient_provider_id,
      });
    }
  }

  // Stable display order — total desc, then event_type asc for ties.
  const by_event_type = Array.from(byEventTypeMap.values()).sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total;
    return a.event_type.localeCompare(b.event_type);
  });

  return NextResponse.json({
    ok: true,
    range,
    since: sinceIso,
    truncated,
    summary,
    by_event_type,
    recent_failures,
  });
}
