/**
 * One-shot diagnostic: list the actual columns of `issue_reports` in
 * the live Supabase project.
 *
 * Strategy:
 *   1. Try selecting a single row. If one exists, the row keys are
 *      authoritative — we get the full column list with no writes.
 *   2. If the table is empty, do a probe insert with the canonical
 *      column set and `.select("*")` the inserted row. The returned
 *      row reveals every column the table actually has. Probe row is
 *      then DELETED via its issue_id so the table is left clean.
 *   3. If the probe insert fails on a missing column, parse the
 *      error message — Supabase tells us "Could not find the 'X'
 *      column", so we report what's missing.
 *
 * Run: cd web && node scripts/inspect-issue-reports-schema.mjs
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
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

async function inspect() {
  console.log("=".repeat(60));
  console.log("issue_reports schema probe");
  console.log("=".repeat(60));

  // 1. Try to read one existing row.
  const { data: existing, error: selectErr } = await sb
    .from("issue_reports")
    .select("*")
    .limit(1);
  if (selectErr) {
    console.error("[select] error:", selectErr.message);
    return;
  }
  if (existing && existing.length > 0) {
    const cols = Object.keys(existing[0]).sort();
    console.log("\nLive columns (from existing row):");
    for (const c of cols) console.log("  -", c);
    return;
  }

  console.log("\nTable is empty. Running probe insert to discover columns...");

  // 2. Probe insert with the broadest reasonable payload. Each column
  //    that the live table has will round-trip; any column it doesn't
  //    have will surface in the error message.
  const probeId = `PROBE-${Date.now()}`;
  // Try the empty-payload route — postgres will fill defaults if the
  // table's PK has one. The returned row reveals every column.
  const probePayload = {};

  const { data: inserted, error: insertErr } = await sb
    .from("issue_reports")
    .insert(probePayload)
    .select("*")
    .single();

  if (insertErr) {
    console.error("\n[probe insert] failed.");
    console.error("  message:", insertErr.message);
    console.error("  code:   ", insertErr.code);
    console.error("  details:", insertErr.details);
    console.error("  hint:   ", insertErr.hint);
    console.error("\nThe error message above names the FIRST offending column.");
    console.error("Re-run after either dropping that key from the probe payload");
    console.error("or running the canonical migration to add it.");
    return;
  }

  if (inserted) {
    const cols = Object.keys(inserted).sort();
    console.log("\nLive columns (from probe row):");
    for (const c of cols) console.log("  -", c);

    // Clean up — delete the probe row so the table is unchanged.
    const idKey = "issue_id" in inserted ? "issue_id" : "id";
    const idVal = inserted[idKey];
    const { error: delErr } = await sb
      .from("issue_reports")
      .delete()
      .eq(idKey, idVal);
    if (delErr) {
      console.warn(
        `\n[cleanup] could not delete probe row ${idKey}=${idVal}: ${delErr.message}`
      );
      console.warn("Manually remove it via the dashboard if desired.");
    } else {
      console.log(`\n[cleanup] probe row ${idKey}=${idVal} deleted.`);
    }
  }
}

await inspect();
