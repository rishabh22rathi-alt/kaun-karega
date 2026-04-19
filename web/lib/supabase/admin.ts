import { createClient } from "@supabase/supabase-js";

// Server-only admin client — uses the service role key, never expose to the browser.
function createAdminClient() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error("Missing env: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(url, key, {
    auth: { persistSession: false },
  });
}

export const adminSupabase = createAdminClient();
