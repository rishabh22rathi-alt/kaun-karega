// One-off read-only diagnostic. Re-broadened scope: surface what categories
// actually exist in tasks vs provider_services, since the original
// "ILIKE %plumb%" probe returned zero rows.

import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  process.exit(1);
}

const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const norm = (s) => String(s || "").trim().toLowerCase();
const print = (label, payload) => {
  console.log(`\n── ${label} ──`);
  console.log(JSON.stringify(payload, null, 2));
};

(async () => {
  // 1. Sanity: how many tasks exist at all.
  const { count: totalTasks, error: totalErr } = await sb
    .from("tasks")
    .select("task_id", { count: "exact", head: true });
  print("1. total rows in tasks", {
    count: totalTasks ?? 0,
    error: totalErr?.message || null,
  });

  // 2. Distinct categories in tasks with counts (pull a generous slice).
  const { data: rows, error: rowsErr } = await sb
    .from("tasks")
    .select("category")
    .limit(10000);
  const buckets = {};
  for (const r of rows || []) {
    const raw = r.category ?? "(null)";
    buckets[raw] = (buckets[raw] || 0) + 1;
  }
  const sorted = Object.entries(buckets)
    .map(([raw, count]) => ({ raw, count, normalized: norm(raw) }))
    .sort((a, b) => b.count - a.count);
  print("2. distinct tasks.category values (top 40 by count)", {
    error: rowsErr?.message || null,
    distinctCount: sorted.length,
    rowsScanned: (rows || []).length,
    top: sorted.slice(0, 40),
  });

  // 3. Look for any plumber-flavored token, case-insensitive, after pulling.
  const plumbHits = sorted.filter((s) => /plumb/i.test(s.raw));
  print("3. tasks.category strings containing 'plumb' (case-insensitive)", {
    hits: plumbHits,
  });

  // 4. provider_services schema probe — fetch one row to see actual columns.
  const { data: psSample, error: psSampleErr } = await sb
    .from("provider_services")
    .select("*")
    .limit(1);
  print("4. provider_services single-row schema probe", {
    error: psSampleErr?.message || null,
    columns: psSample && psSample[0] ? Object.keys(psSample[0]) : [],
    sample: psSample,
  });

  // 5. provider_services category distribution — pull all rows and bucket
  //    in JS so we don't trip on missing columns.
  const { data: psRows, error: psErr } = await sb
    .from("provider_services")
    .select("provider_id, category")
    .limit(5000);
  const psBuckets = {};
  for (const r of psRows || []) {
    const raw = r.category ?? "(null)";
    psBuckets[raw] = (psBuckets[raw] || 0) + 1;
  }
  const psSorted = Object.entries(psBuckets)
    .map(([raw, count]) => ({ raw, count, normalized: norm(raw) }))
    .sort((a, b) => b.count - a.count);
  print("5. distinct provider_services.category values (top 40)", {
    error: psErr?.message || null,
    distinctCount: psSorted.length,
    rowsScanned: (psRows || []).length,
    top: psSorted.slice(0, 40),
  });

  // 6. Plumber-flavored on the provider side.
  const psPlumbHits = psSorted.filter((s) => /plumb/i.test(s.raw));
  print("6. provider_services.category strings containing 'plumb'", {
    hits: psPlumbHits,
  });

  // 7. Overlap report: every provider category checked against the tasks
  //    category set, both case-sensitive and normalized.
  const taskRaw = new Set(Object.keys(buckets));
  const taskNorm = new Set(Array.from(taskRaw).map((s) => norm(s)));
  const overlap = psSorted.map((ps) => ({
    providerSide: ps.raw,
    providerCount: ps.count,
    exactMatchInTasks: taskRaw.has(ps.raw),
    normalizedMatchInTasks: taskNorm.has(norm(ps.raw)),
  }));
  print("7. provider_services category vs tasks category overlap", { overlap });
})();
