// One-off read-only probe. Determines whether the work-terms-related
// migrations have been applied and whether the Plumber-related rows exist
// for the kinds of operations the dashboard chip tap triggers.

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
  // 1. Does provider_work_terms exist? Any error here is the smoking gun
  //    for migration-not-applied.
  const { error: pwtErr } = await sb
    .from("provider_work_terms")
    .select("id", { count: "exact", head: true });
  print("1. provider_work_terms exists?", {
    ok: !pwtErr,
    errorCode: pwtErr?.code || null,
    errorMessage: pwtErr?.message || null,
    hint: pwtErr?.hint || null,
  });

  // 2. Does category_aliases.submitted_by_provider_id exist?
  const { error: subErr } = await sb
    .from("category_aliases")
    .select("submitted_by_provider_id")
    .limit(1);
  print("2. category_aliases.submitted_by_provider_id exists?", {
    ok: !subErr,
    errorCode: subErr?.code || null,
    errorMessage: subErr?.message || null,
  });

  // 3. Does provider_notifications exist?
  const { error: nfErr } = await sb
    .from("provider_notifications")
    .select("id", { count: "exact", head: true });
  print("3. provider_notifications exists?", {
    ok: !nfErr,
    errorCode: nfErr?.code || null,
    errorMessage: nfErr?.message || null,
  });

  // 4. Does any provider currently offer "Plumber"? (Used by chip flow.)
  const { data: plumberPs, error: psErr } = await sb
    .from("provider_services")
    .select("provider_id, category")
    .ilike("category", "Plumber")
    .limit(5);
  print("4. providers offering Plumber (sample)", {
    error: psErr?.message || null,
    sample: plumberPs || [],
  });

  // 5. Are there active work_tag aliases for Plumber? (Determines whether
  //    chips even render in the UI.)
  const { data: aliases, error: aliasErr } = await sb
    .from("category_aliases")
    .select("alias, canonical_category, active, alias_type")
    .ilike("canonical_category", "Plumber")
    .eq("active", true)
    .eq("alias_type", "work_tag");
  print("5. active work_tag aliases for Plumber", {
    error: aliasErr?.message || null,
    rows: aliases || [],
  });
})();
