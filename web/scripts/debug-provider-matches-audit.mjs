// One-off read-only diagnostic for the "Matched To You" and "Responded By
// You" provider dashboard metrics. Verifies the queries in
// app/api/provider/dashboard-profile/route.ts against real DB rows:
//
//   Matched   = SELECT count(*) FROM provider_task_matches
//                WHERE provider_id = X [AND created_at >= since]
//   Responded = same + match_status IN ('responded','accepted')
//   Accepted  = same + match_status IN ('accepted','assigned')
//
// Probes schema, status distribution, duplicates, orphan rows, and picks a
// sample provider with the most matches to cross-validate the displayed
// metric vs raw row counts.

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

const print = (label, payload) => {
  console.log(`\n── ${label} ──`);
  console.log(JSON.stringify(payload, null, 2));
};

(async () => {
  // 1. Schema probe — what columns does provider_task_matches actually have?
  const { data: sample, error: sampleErr } = await sb
    .from("provider_task_matches")
    .select("*")
    .limit(1);
  print("1. provider_task_matches single-row schema probe", {
    error: sampleErr?.message || null,
    columns: sample && sample[0] ? Object.keys(sample[0]) : [],
    sampleRow: sample,
  });

  // 2. Total row count.
  const { count: totalMatches, error: totalErr } = await sb
    .from("provider_task_matches")
    .select("provider_id", { count: "exact", head: true });
  print("2. total rows in provider_task_matches", {
    count: totalMatches ?? 0,
    error: totalErr?.message || null,
  });

  // 3. Distinct match_status values + frequencies.
  const { data: statusRows, error: statusErr } = await sb
    .from("provider_task_matches")
    .select("match_status")
    .limit(20000);
  const statusBuckets = {};
  for (const r of statusRows || []) {
    const v = r.match_status === null ? "(null)" : r.match_status;
    statusBuckets[v] = (statusBuckets[v] || 0) + 1;
  }
  print("3. distribution of match_status values", {
    error: statusErr?.message || null,
    rowsScanned: (statusRows || []).length,
    distribution: Object.entries(statusBuckets)
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count),
  });

  // 4. Pull all rows (capped) so we can do per-provider analysis in JS.
  const { data: allRows, error: allErr } = await sb
    .from("provider_task_matches")
    .select("provider_id, task_id, match_status, created_at")
    .limit(20000);
  if (allErr) {
    print("4. ERROR fetching matches", { error: allErr.message });
    return;
  }

  // 5. Per-provider tallies: matches, responded+accepted, accepted-only,
  //    duplicates (multiple rows for the same (provider_id, task_id)).
  const byProvider = {};
  for (const r of allRows) {
    const p = String(r.provider_id || "").trim();
    if (!p) continue;
    const status = String(r.match_status || "").toLowerCase();
    const taskId = String(r.task_id || "").trim();
    const bucket = (byProvider[p] ||= {
      matches: 0,
      responded: 0,
      accepted: 0,
      assigned: 0,
      taskIdCounts: {},
      statuses: {},
    });
    bucket.matches += 1;
    if (status === "responded" || status === "accepted") bucket.responded += 1;
    if (status === "accepted") bucket.accepted += 1;
    if (status === "assigned") bucket.assigned += 1;
    bucket.taskIdCounts[taskId] = (bucket.taskIdCounts[taskId] || 0) + 1;
    bucket.statuses[status || "(empty)"] =
      (bucket.statuses[status || "(empty)"] || 0) + 1;
  }

  // 6. Duplicate detection across whole table.
  const dupSummary = [];
  for (const [pid, b] of Object.entries(byProvider)) {
    const dupTasks = Object.entries(b.taskIdCounts).filter(([, n]) => n > 1);
    if (dupTasks.length > 0) {
      dupSummary.push({
        provider_id: pid,
        duplicateTaskCount: dupTasks.length,
        sample: dupTasks.slice(0, 3).map(([tid, n]) => ({ taskId: tid, rowCount: n })),
      });
    }
  }
  print("6. providers with duplicate (provider_id, task_id) match rows", {
    totalProvidersAffected: dupSummary.length,
    sampleAffected: dupSummary.slice(0, 5),
  });

  // 7. Top providers by raw match count — pick the heaviest as our test case.
  const topProviders = Object.entries(byProvider)
    .map(([pid, b]) => ({
      provider_id: pid,
      matches: b.matches,
      responded: b.responded,
      accepted: b.accepted,
      assigned: b.assigned,
      uniqueTasks: Object.keys(b.taskIdCounts).length,
      statuses: b.statuses,
    }))
    .sort((a, b) => b.matches - a.matches)
    .slice(0, 5);
  print("7. top 5 providers by raw match count", { top: topProviders });

  // 8. For the heaviest provider, run the EXACT dashboard query and compare.
  const sampleProvider = topProviders[0];
  if (sampleProvider) {
    const pid = sampleProvider.provider_id;

    const matchedQ = await sb
      .from("provider_task_matches")
      .select("task_id", { count: "exact", head: true })
      .eq("provider_id", pid);

    const respondedQ = await sb
      .from("provider_task_matches")
      .select("task_id", { count: "exact", head: true })
      .eq("provider_id", pid)
      .in("match_status", ["responded", "accepted"]);

    const acceptedQ = await sb
      .from("provider_task_matches")
      .select("task_id, created_at")
      .eq("provider_id", pid)
      .in("match_status", ["accepted", "assigned"]);

    print("8. dashboard-style query result for provider " + pid, {
      api: {
        matchedCount: matchedQ.count ?? 0,
        respondedCount: respondedQ.count ?? 0,
        acceptedRows: (acceptedQ.data || []).length,
      },
      js: {
        matchesInJsBucket: sampleProvider.matches,
        respondedInJsBucket: sampleProvider.responded,
        acceptedOrAssignedInJsBucket:
          sampleProvider.accepted + sampleProvider.assigned,
        uniqueTasksInJsBucket: sampleProvider.uniqueTasks,
      },
      delta: {
        matchedDiff: (matchedQ.count ?? 0) - sampleProvider.matches,
        respondedDiff: (respondedQ.count ?? 0) - sampleProvider.responded,
        // Inflation factor — if matches > unique tasks, duplicates are
        // padding the count.
        rowsToUniqueTaskRatio: (
          sampleProvider.matches / Math.max(1, sampleProvider.uniqueTasks)
        ).toFixed(2),
      },
      computedResponseRate:
        sampleProvider.matches > 0
          ? Math.round((sampleProvider.responded / sampleProvider.matches) * 100) +
            "%"
          : "n/a (no matches)",
    });
  }

  // 9. Orphan check: do any matched task_ids point to tasks that don't exist?
  const allTaskIds = Array.from(
    new Set(allRows.map((r) => String(r.task_id || "").trim()).filter(Boolean))
  );
  const sampleTaskIds = allTaskIds.slice(0, 100);
  const { data: existing, error: existErr } = await sb
    .from("tasks")
    .select("task_id")
    .in("task_id", sampleTaskIds);
  const existingSet = new Set((existing || []).map((r) => r.task_id));
  const orphans = sampleTaskIds.filter((id) => !existingSet.has(id));
  print("9. orphan-row probe (matches whose task_id is missing from tasks)", {
    error: existErr?.message || null,
    sampledTaskIds: sampleTaskIds.length,
    orphansFound: orphans.length,
    sampleOrphans: orphans.slice(0, 5),
  });

  // 10. created_at recency check — when was the last match created?
  const sortedByDate = (allRows || [])
    .map((r) => Date.parse(String(r.created_at || "")))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => b - a);
  print("10. created_at recency", {
    rowsWithValidCreatedAt: sortedByDate.length,
    newestIso: sortedByDate[0] ? new Date(sortedByDate[0]).toISOString() : null,
    oldestIso: sortedByDate.length
      ? new Date(sortedByDate[sortedByDate.length - 1]).toISOString()
      : null,
  });
})();
