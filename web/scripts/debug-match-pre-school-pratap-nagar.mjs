// One-off matching-pipeline diagnostic. Walks the same code path as
// /api/process-task-notifications and /api/find-provider, step by step,
// and prints the row count + sample IDs at each stage. Read-only.
//
// Run with:
//   node scripts/debug-match-pre-school-pratap-nagar.mjs

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

const CATEGORY = "Pre School";
const AREA = "Pratap Nagar";

const print = (label, value) => {
  console.log(`\n── ${label} ──`);
  console.log(JSON.stringify(value, null, 2));
};

const lower = (s) => String(s || "").trim().toLowerCase();

(async () => {
  // STEP 1 — categories gate (matching code requires category in categories(active=true))
  const { data: catExact, error: catExactErr } = await sb
    .from("categories")
    .select("name, active")
    .eq("name", CATEGORY);
  print("STEP 1a — categories WHERE name = 'Pre School' (case-sensitive)", {
    error: catExactErr?.message || null,
    rows: catExact,
  });

  const { data: catAll, error: catAllErr } = await sb
    .from("categories")
    .select("name, active")
    .ilike("name", "pre school");
  print("STEP 1b — categories ILIKE 'pre school' (case-insensitive)", {
    error: catAllErr?.message || null,
    rows: catAll,
  });

  const activeMatches = (catAll || []).filter(
    (r) => r.active === true || lower(r.active) === "yes" || lower(r.active) === "true"
  );
  print("STEP 1c — active variants of 'Pre School'", {
    count: activeMatches.length,
    rows: activeMatches,
  });

  // STEP 2 — provider_services with category = 'Pre School'
  const { data: services, error: svcErr } = await sb
    .from("provider_services")
    .select("provider_id, category")
    .eq("category", CATEGORY);
  print("STEP 2 — provider_services WHERE category = 'Pre School' (exact)", {
    error: svcErr?.message || null,
    count: (services || []).length,
    rows: services,
  });

  const svcCaseScan = await sb
    .from("provider_services")
    .select("provider_id, category")
    .ilike("category", "pre school");
  print("STEP 2b — provider_services ILIKE 'pre school' (case-insensitive)", {
    error: svcCaseScan.error?.message || null,
    count: (svcCaseScan.data || []).length,
    rows: svcCaseScan.data,
  });

  // STEP 3 — provider_areas with area = 'Pratap Nagar'
  const { data: areas, error: areaErr } = await sb
    .from("provider_areas")
    .select("provider_id, area")
    .eq("area", AREA);
  print("STEP 3 — provider_areas WHERE area = 'Pratap Nagar' (exact)", {
    error: areaErr?.message || null,
    count: (areas || []).length,
    rows: areas,
  });

  const areaCaseScan = await sb
    .from("provider_areas")
    .select("provider_id, area")
    .ilike("area", "pratap nagar");
  print("STEP 3b — provider_areas ILIKE 'pratap nagar' (case-insensitive)", {
    error: areaCaseScan.error?.message || null,
    count: (areaCaseScan.data || []).length,
    rows: areaCaseScan.data,
  });

  // STEP 4 — areas / area_aliases canonicalization candidates
  let canonicalProbe = null;
  try {
    const { data, error } = await sb
      .from("areas")
      .select("name, active")
      .ilike("name", "pratap nagar");
    canonicalProbe = { table: "areas", error: error?.message || null, rows: data };
  } catch (e) {
    canonicalProbe = { table: "areas", error: e?.message || String(e) };
  }
  print("STEP 4a — areas table (canonical?) ILIKE 'pratap nagar'", canonicalProbe);

  let aliasProbe = null;
  try {
    const { data, error } = await sb
      .from("area_aliases")
      .select("alias_name, canonical_area, active")
      .ilike("alias_name", "pratap nagar");
    aliasProbe = { table: "area_aliases", error: error?.message || null, rows: data };
  } catch (e) {
    aliasProbe = { table: "area_aliases", error: e?.message || String(e) };
  }
  print("STEP 4b — area_aliases ILIKE 'pratap nagar'", aliasProbe);

  let reviewProbe = null;
  try {
    const { data, error } = await sb
      .from("area_review_queue")
      .select("raw_area, normalized_key, status, resolved_canonical_area")
      .or("raw_area.ilike.pratap nagar,normalized_key.ilike.pratap nagar");
    reviewProbe = { table: "area_review_queue", error: error?.message || null, rows: data };
  } catch (e) {
    reviewProbe = { table: "area_review_queue", error: e?.message || String(e) };
  }
  print("STEP 4c — area_review_queue for 'pratap nagar'", reviewProbe);

  // STEP 5 — intersection of provider_services × provider_areas (the matching algorithm)
  const svcIds = new Set((services || []).map((r) => String(r.provider_id || "").trim()).filter(Boolean));
  const areaIds = new Set((areas || []).map((r) => String(r.provider_id || "").trim()).filter(Boolean));
  const intersection = [...svcIds].filter((id) => areaIds.has(id));
  print("STEP 5 — intersection (exact match, like the matching code)", {
    serviceCount: svcIds.size,
    areaCount: areaIds.size,
    intersectionCount: intersection.length,
    intersectionIds: intersection,
  });

  // Also try a case-insensitive intersection in case the code's exact eq is the bottleneck.
  const svcIdsCi = new Set((svcCaseScan.data || []).map((r) => String(r.provider_id || "").trim()).filter(Boolean));
  const areaIdsCi = new Set((areaCaseScan.data || []).map((r) => String(r.provider_id || "").trim()).filter(Boolean));
  const intersectionCi = [...svcIdsCi].filter((id) => areaIdsCi.has(id));
  print("STEP 5b — intersection (case-insensitive)", {
    serviceCountCi: svcIdsCi.size,
    areaCountCi: areaIdsCi.size,
    intersectionCountCi: intersectionCi.length,
    intersectionIdsCi: intersectionCi,
  });

  // STEP 6 — providers row check (status="blocked" filter, phone presence) for the union
  const allCandidateIds = Array.from(new Set([...intersection, ...intersectionCi]));
  if (allCandidateIds.length > 0) {
    const { data: provs, error: provErr } = await sb
      .from("providers")
      .select("provider_id, full_name, phone, status, verified")
      .in("provider_id", allCandidateIds);
    print("STEP 6 — providers row for matched IDs", {
      error: provErr?.message || null,
      count: (provs || []).length,
      rows: provs,
    });

    const blockedCount = (provs || []).filter(
      (p) => lower(p.status) === "blocked"
    ).length;
    const missingPhoneCount = (provs || []).filter(
      (p) => !String(p.phone || "").replace(/\D/g, "").trim()
    ).length;
    const invalidMobile = (provs || []).filter((p) => {
      const d = String(p.phone || "").replace(/\D/g, "");
      return d.length < 10;
    }).length;
    print("STEP 6b — providers filter analysis", {
      blockedCount,
      missingPhoneCount,
      invalidMobileCount: invalidMobile,
      finalMatchableCount:
        (provs || []).filter(
          (p) =>
            lower(p.status) !== "blocked" &&
            String(p.phone || "").replace(/\D/g, "").trim().length >= 10
        ).length,
    });
  } else {
    print("STEP 6 — skipped (no candidate provider IDs from intersection)", {});
  }

  // EXTRA — sample of providers whose service is Pre School (regardless of area)
  if ((services || []).length === 0) {
    const { data: anyPreSchool, error: anyErr } = await sb
      .from("provider_services")
      .select("provider_id, category")
      .ilike("category", "%pre%school%");
    print("EXTRA — provider_services with 'pre' AND 'school' anywhere", {
      error: anyErr?.message || null,
      count: (anyPreSchool || []).length,
      rows: (anyPreSchool || []).slice(0, 20),
    });
  }

  // EXTRA — sample provider_areas with anything containing 'pratap'
  if ((areas || []).length === 0) {
    const { data: anyPratap, error: anyErr } = await sb
      .from("provider_areas")
      .select("provider_id, area")
      .ilike("area", "%pratap%");
    print("EXTRA — provider_areas with 'pratap' anywhere", {
      error: anyErr?.message || null,
      count: (anyPratap || []).length,
      rows: (anyPratap || []).slice(0, 20),
    });
  }
})()
  .catch((e) => {
    console.error("FATAL", e);
    process.exit(1);
  });
