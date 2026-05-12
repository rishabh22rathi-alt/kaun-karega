/**
 * Cleanup utility — surface and remediate legacy auto-approved
 * provider_services rows whose category never reached
 * `categories.active=true`.
 *
 * Why this exists: before the category-governance patch, the provider
 * register / update flows inserted ALL submitted categories — canonical
 * + custom — into provider_services. Custom rows surfaced as
 * "Active Approved Service Category" chips on the dashboard despite no
 * admin approval.
 *
 * Two remediation modes today (default is DRY-RUN: list + exit):
 *   - `--apply`            DELETE the leaked rows from provider_services.
 *   - `--backfill-pending` Keep the row, but INSERT a matching
 *                          pending_category_requests entry (status=pending)
 *                          when one is missing. The dashboard's status
 *                          derivation will then surface the row in the
 *                          Pending Service Category Requests block via
 *                          the existing pending lookup path; admins can
 *                          decide to approve or reject from the admin
 *                          Category tab. Idempotent — re-runs no-op once
 *                          every candidate has a request row.
 *
 *   --json                 Print the candidate list as JSON (works in
 *                          all modes — useful for CI replay).
 *
 * The two destructive flags are mutually exclusive. Pick the one that
 * fits the leak: backfill when admins still need to triage the request
 * lifecycle, apply when you've verified the row is genuinely garbage.
 *
 * Usage:
 *   node scripts/cleanup-leaked-provider-services.mjs                    # dry-run
 *   node scripts/cleanup-leaked-provider-services.mjs --json             # dry-run + JSON
 *   node scripts/cleanup-leaked-provider-services.mjs --apply            # DELETE rows
 *   node scripts/cleanup-leaked-provider-services.mjs --backfill-pending # INSERT pending requests
 *
 * Env (.env.local):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");
const BACKFILL = argv.has("--backfill-pending");
const JSON_OUT = argv.has("--json");

if (APPLY && BACKFILL) {
  console.error(
    "[cleanup] --apply and --backfill-pending are mutually exclusive. Pick one."
  );
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const norm = (s) => String(s || "").trim().toLowerCase();

(async () => {
  // 1) Active categories — the source of truth for "approved".
  const { data: catRows, error: catErr } = await sb
    .from("categories")
    .select("name, active")
    .eq("active", true);
  if (catErr) {
    console.error("[cleanup] categories fetch failed:", catErr.message);
    process.exit(2);
  }
  const activeKeys = new Set(
    (catRows || []).map((r) => norm(r.name)).filter(Boolean)
  );
  console.log(
    `[cleanup] ${activeKeys.size} active categories in the master list.`
  );

  // 2) Pending category requests — used to attach an inferred lifecycle
  // status to each leaked row in the report. The script does NOT use
  // this for the delete decision (delete is purely "not in active
  // categories"), only for human-readable context.
  const { data: pendingRows, error: pendingErr } = await sb
    .from("pending_category_requests")
    .select("provider_id, requested_category, status, admin_action_at");
  if (pendingErr) {
    console.warn(
      "[cleanup] pending_category_requests fetch warned:",
      pendingErr.message
    );
  }
  const pendingByProviderKey = new Map(); // `${providerId}::${categoryKey}` → status
  for (const row of pendingRows || []) {
    const k = `${String(row.provider_id || "")}::${norm(row.requested_category)}`;
    pendingByProviderKey.set(k, String(row.status || "").toLowerCase());
  }

  // 3) provider_services — every row whose category is NOT in the
  // active-categories set is a leak candidate.
  const { data: serviceRows, error: serviceErr } = await sb
    .from("provider_services")
    .select("provider_id, category");
  if (serviceErr) {
    console.error("[cleanup] provider_services fetch failed:", serviceErr.message);
    process.exit(3);
  }

  const candidates = [];
  for (const row of serviceRows || []) {
    const providerId = String(row.provider_id || "");
    const category = String(row.category || "");
    const key = norm(category);
    if (!providerId || !key) continue;
    if (activeKeys.has(key)) continue; // legitimate approved row — skip
    const k = `${providerId}::${key}`;
    const inferredStatus = pendingByProviderKey.get(k) || "(no request row)";
    candidates.push({
      provider_id: providerId,
      category,
      inferred_request_status: inferredStatus,
    });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify({ candidates }, null, 2));
  } else {
    console.log(`\n[cleanup] ${candidates.length} leaked provider_services row(s):`);
    for (const c of candidates) {
      console.log(
        `  provider_id=${c.provider_id}  category="${c.category}"  request_status=${c.inferred_request_status}`
      );
    }
  }

  if (!APPLY && !BACKFILL) {
    console.log(
      "\n[cleanup] DRY-RUN only. Re-run with --apply to delete the rows above," +
        "\n          or --backfill-pending to insert missing pending_category_requests."
    );
    return;
  }

  if (candidates.length === 0) {
    console.log("[cleanup] Nothing to do.");
    return;
  }

  if (APPLY) {
    // Delete one at a time so we get per-row failure visibility and so a
    // bad row doesn't take down a batch. Cheap — counts are typically in
    // the dozens, not thousands. Supabase JS has no transaction primitive
    // so per-row delete is the safe path either way.
    let deleted = 0;
    let failed = 0;
    for (const c of candidates) {
      const { error } = await sb
        .from("provider_services")
        .delete()
        .eq("provider_id", c.provider_id)
        .eq("category", c.category);
      if (error) {
        failed += 1;
        console.error(
          `[cleanup] FAILED provider_id=${c.provider_id} category="${c.category}":`,
          error.message
        );
      } else {
        deleted += 1;
      }
    }
    console.log(
      `\n[cleanup] Done. deleted=${deleted} failed=${failed} total_candidates=${candidates.length}`
    );
    return;
  }

  // --backfill-pending: keep the provider_services row, just ensure a
  // pending_category_requests entry exists for the same provider+category
  // so the dashboard surfaces the request properly and admins can act.
  // Skip candidates that already have a request row (idempotent on retry).
  let inserted = 0;
  let skipped = 0;
  let failed = 0;
  const nowIso = new Date().toISOString();
  for (const c of candidates) {
    if (c.inferred_request_status !== "(no request row)") {
      // Request row already exists for this provider/category — leave it
      // alone. If status is "pending"/"rejected" the dashboard already
      // surfaces it; if it's "approved" the upsert into categories must
      // have been skipped at approve time (separate manual fix needed).
      skipped += 1;
      continue;
    }
    // Pull the provider's full_name + phone for the audit fields.
    const { data: providerRow } = await sb
      .from("providers")
      .select("full_name, phone")
      .eq("provider_id", c.provider_id)
      .maybeSingle();
    const { error } = await sb.from("pending_category_requests").insert({
      request_id: `PCR-${randomUUID()}`,
      provider_id: c.provider_id,
      provider_name: String(providerRow?.full_name || "").trim() || null,
      phone: String(providerRow?.phone || "").trim() || null,
      requested_category: c.category,
      status: "pending",
      created_at: nowIso,
    });
    if (error) {
      failed += 1;
      console.error(
        `[cleanup] BACKFILL FAILED provider_id=${c.provider_id} category="${c.category}":`,
        error.message
      );
    } else {
      inserted += 1;
    }
  }
  console.log(
    `\n[cleanup] Backfill done. inserted=${inserted} skipped=${skipped} failed=${failed} total_candidates=${candidates.length}`
  );
})();
