/**
 * POST /api/admin/need-chat-backfill
 *
 * One-time, idempotent backfill: migrates legacy need_chat threads (and their
 * messages) from GAS into Supabase so the "Thread not found" GAS fallbacks in
 * need_chat_get_messages / need_chat_mark_read / need_chat_send_message can be
 * removed once all threads are confirmed present in Supabase.
 *
 * STRATEGY: thread + messages (full snapshot)
 *   - Thread-only sync fixes mark_read / send_message but NOT get_messages.
 *   - Full snapshot via syncNeedChatSnapshotFromGasPayload fixes all three.
 *
 * SAFETY:
 *   - Admin session required (401 otherwise).
 *   - dryRun defaults to true — no GAS calls, no writes unless explicitly opted in.
 *   - Skips threads already present in Supabase (idempotent).
 *   - All writes use upsert (conflict on thread_id / message_id) — safe to re-run.
 *
 * REQUEST BODY:
 *   {
 *     dryRun:  boolean   // default true — set false to actually write
 *     needIds: string[]  // optional — process only these NeedIDs; omit for batch
 *     limit:   number    // max needs to process (default 20, max 50); ignored if needIds set
 *   }
 *
 * RESPONSE (dry run):
 *   { ok: true, dryRun: true, report: { needsInSupabase, threadsAlreadyInSupabase, note } }
 *
 * RESPONSE (real run):
 *   { ok: true, dryRun: false, report: {
 *       needsProcessed, threadsFoundInGas,
 *       threadsAlreadyInSupabase, threadsSynced,
 *       errors: string[]
 *   } }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";
import { adminSupabase } from "@/lib/supabase/admin";
import {
  syncNeedChatSnapshotFromGasPayload,
} from "@/lib/chat/chatPersistence";

export const dynamic = "force-dynamic";

const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_URL;

// ─── GAS call helper ──────────────────────────────────────────────────────────

async function callGas(
  action: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (!APPS_SCRIPT_URL) throw new Error("APPS_SCRIPT_URL is not configured");
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/plain, */*",
    },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error(`GAS HTTP ${res.status} for action=${action}`);
  const json = await res.json() as Record<string, unknown>;
  return json;
}

function normalizePhone10(raw: string): string {
  return String(raw || "").replace(/\D/g, "").slice(-10);
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  // Default dryRun=true for safety — must explicitly pass false to write
  const dryRun = body.dryRun !== false;
  const requestedNeedIds = Array.isArray(body.needIds)
    ? (body.needIds as string[]).filter((id) => typeof id === "string" && id.trim())
    : null;
  const rawLimit = typeof body.limit === "number" ? body.limit : 20;
  const limit = Math.min(Math.max(1, rawLimit), 50);

  // ── DRY RUN: Supabase counts only — no GAS, no writes ────────────────────
  if (dryRun) {
    const { count: needCount, error: needCountError } = await adminSupabase
      .from("needs")
      .select("need_id", { count: "exact", head: true });

    const { count: threadCount, error: threadCountError } = await adminSupabase
      .from("need_chat_threads")
      .select("thread_id", { count: "exact", head: true });

    if (needCountError || threadCountError) {
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to count records",
          details: needCountError?.message ?? threadCountError?.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      dryRun: true,
      report: {
        needsInSupabase: needCount ?? 0,
        threadsAlreadyInSupabase: threadCount ?? 0,
        note: "Dry run — no GAS calls made, no writes. Pass dryRun:false to run the backfill.",
      },
    });
  }

  // ── REAL RUN ──────────────────────────────────────────────────────────────

  type NeedRow = { need_id: string; user_phone: string };
  let needs: NeedRow[];

  if (requestedNeedIds && requestedNeedIds.length > 0) {
    const { data, error } = await adminSupabase
      .from("needs")
      .select("need_id, user_phone")
      .in("need_id", requestedNeedIds);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    needs = (data ?? []) as NeedRow[];
  } else {
    const { data, error } = await adminSupabase
      .from("needs")
      .select("need_id, user_phone")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }
    needs = (data ?? []) as NeedRow[];
  }

  const report = {
    needsProcessed: 0,
    threadsFoundInGas: 0,
    threadsAlreadyInSupabase: 0,
    threadsSynced: 0,
    errors: [] as string[],
  };

  for (const need of needs) {
    const posterPhone = normalizePhone10(need.user_phone);
    if (!posterPhone) {
      report.errors.push(`${need.need_id}: skipped — no poster phone`);
      continue;
    }

    // Step 1: ask GAS for all threads for this need (as poster)
    let gasThreads: Array<Record<string, unknown>>;
    try {
      const gasResponse = await callGas("need_chat_get_threads_for_need", {
        NeedID: need.need_id,
        UserPhone: posterPhone,
      });
      if (!gasResponse.ok) {
        report.errors.push(`${need.need_id}: GAS need_chat_get_threads_for_need returned ok:false`);
        continue;
      }
      gasThreads = Array.isArray(gasResponse.threads)
        ? (gasResponse.threads as Array<Record<string, unknown>>)
        : [];
    } catch (err) {
      report.errors.push(
        `${need.need_id}: GAS error — ${err instanceof Error ? err.message : String(err)}`
      );
      continue;
    }

    report.needsProcessed += 1;
    report.threadsFoundInGas += gasThreads.length;

    // Step 2: for each thread, check Supabase and sync if missing
    for (const gasThread of gasThreads) {
      const threadId = String(gasThread.ThreadID || "").trim();
      if (!threadId) continue;

      // Idempotency: skip threads already in Supabase
      const { data: existing, error: lookupError } = await adminSupabase
        .from("need_chat_threads")
        .select("thread_id")
        .eq("thread_id", threadId)
        .maybeSingle();

      if (lookupError) {
        report.errors.push(`${threadId}: Supabase lookup error — ${lookupError.message}`);
        continue;
      }
      if (existing) {
        report.threadsAlreadyInSupabase += 1;
        continue;
      }

      // Step 3: fetch full snapshot (thread + messages) from GAS
      try {
        const snapshot = await callGas("need_chat_get_messages", {
          ThreadID: threadId,
          ActorRole: "poster",
          UserPhone: posterPhone,
        });

        if (!snapshot.ok) {
          report.errors.push(`${threadId}: GAS need_chat_get_messages returned ok:false`);
          continue;
        }

        // syncNeedChatSnapshotFromGasPayload upserts thread + messages — idempotent
        await syncNeedChatSnapshotFromGasPayload(snapshot);
        report.threadsSynced += 1;
      } catch (err) {
        report.errors.push(
          `${threadId}: sync error — ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    report,
  });
}
