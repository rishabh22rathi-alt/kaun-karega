/**
 * Cleanup utility — remove legacy auto-approved provider_services rows
 * whose category never reached `categories.active=true`.
 *
 * Why this exists: before the category-governance patch, the provider
 * register / update flows inserted ALL submitted categories — canonical
 * + custom — into provider_services. Custom rows surfaced as
 * "Active Approved Service Category" chips on the dashboard despite no
 * admin approval. The dashboard fix downgrades those rows to "inactive"
 * at render time; this script optionally deletes them from the table.
 *
 * Default mode is DRY-RUN — it lists candidates and exits. Pass --apply
 * to actually delete the rows. Pass --json to emit the candidate list as
 * structured JSON (handy for CI / replay).
 *
 * Usage:
 *   node scripts/cleanup-leaked-provider-services.mjs            # dry-run
 *   node scripts/cleanup-leaked-provider-services.mjs --json     # dry-run + JSON
 *   node scripts/cleanup-leaked-provider-services.mjs --apply    # DELETE
 *
 * Env (.env.local):
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has("--apply");
const JSON_OUT = argv.has("--json");

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

  if (!APPLY) {
    console.log(
      "\n[cleanup] DRY-RUN only. Re-run with --apply to delete the rows above."
    );
    return;
  }

  if (candidates.length === 0) {
    console.log("[cleanup] Nothing to delete.");
    return;
  }

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
})();
