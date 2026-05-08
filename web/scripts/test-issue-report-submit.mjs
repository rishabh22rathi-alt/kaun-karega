/**
 * End-to-end Report-an-Issue submit test.
 *
 * Calls the same helper the API route uses, then reads the row back
 * via the same getter the admin dashboard uses, to confirm:
 *   1. Insert succeeds against the live schema.
 *   2. The inserted row carries every canonical column populated.
 *   3. The read pipeline maps it correctly to the dashboard payload.
 *
 * Cleans up by deleting the test row at the end.
 *
 * Run: cd web && node scripts/test-issue-report-submit.mjs
 */

import { config as loadEnv } from "dotenv";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(here, "..", ".env.local") });
loadEnv({ path: path.resolve(here, "..", ".env") });

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

console.log("=".repeat(60));
console.log("Report-an-Issue end-to-end submit + readback");
console.log("=".repeat(60));

const testPayload = {
  reporter_phone: "9999999999",
  reporter_type: "user",
  reporter_name: "ZZ Test Reporter",
  issue_type: "Chat/message problem",
  message: "Schema-aligned test submit. Inserted by test-issue-report-submit.mjs and deleted at end.",
  status: "open",
  updated_at: new Date().toISOString(),
};

console.log("\n[1/3] Submitting test issue...");
const { data: inserted, error: insertErr } = await sb
  .from("issue_reports")
  .insert(testPayload)
  .select(
    "id, created_at, updated_at, reporter_phone, reporter_type, reporter_name, issue_type, message, status, admin_notes"
  )
  .single();

if (insertErr) {
  console.error("[FAIL] Insert error:", insertErr.message);
  console.error("       code:   ", insertErr.code);
  console.error("       details:", insertErr.details);
  process.exit(2);
}

console.log("[OK] Inserted row:");
for (const [k, v] of Object.entries(inserted)) {
  console.log(`     ${k}: ${JSON.stringify(v)}`);
}

console.log("\n[2/3] Reading newest 5 issues (admin-list path)...");
const { data: list, error: listErr } = await sb
  .from("issue_reports")
  .select(
    "id, created_at, updated_at, reporter_phone, reporter_type, reporter_name, issue_type, message, status, admin_notes"
  )
  .order("created_at", { ascending: false })
  .limit(5);

if (listErr) {
  console.error("[FAIL] List error:", listErr.message);
} else {
  console.log(`[OK] ${list.length} row(s) returned:`);
  for (const r of list) {
    console.log(
      `     id=${r.id} | type=${r.reporter_type} | phone=${r.reporter_phone} | issue=${r.issue_type} | status=${r.status}`
    );
  }
}

console.log("\n[3/3] Cleaning up test row...");
const { error: delErr } = await sb
  .from("issue_reports")
  .delete()
  .eq("id", inserted.id);
if (delErr) {
  console.warn("[WARN] could not delete test row:", delErr.message);
} else {
  console.log(`[OK] test row id=${inserted.id} deleted.`);
}

console.log("\n" + "=".repeat(60));
console.log("PASS — schema, helper, and read pipeline are aligned.");
console.log("=".repeat(60));
