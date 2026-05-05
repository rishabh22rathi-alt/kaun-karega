import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";

// Disabled. This route was a one-shot Apps-Script-to-Supabase backfill that
// pulled provider rows from the legacy GAS sheet. Providers now live in
// Supabase as the source of truth and this migration has run.
//
// Auth check is preserved so the disabled response is only visible to a
// signed-in admin (no information leakage).
export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }
  return NextResponse.json(
    {
      ok: false,
      error:
        "Provider migration route disabled. Supabase is now the source of truth.",
    },
    { status: 410 }
  );
}

export async function GET(request: Request) {
  return POST(request);
}
