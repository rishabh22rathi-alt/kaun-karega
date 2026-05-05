import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/adminAuth";

export const dynamic = "force-dynamic";

// Disabled. This route was a one-shot backfill that pulled legacy need_chat
// threads from Apps Script into Supabase. Need-chat is now Supabase-native
// (see /api/kk action="need_chat_*" intercepts and chatPersistence.ts);
// the backfill has run and the GAS fallbacks have been removed.
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
        "Need-chat backfill route disabled. Supabase is now the source of truth.",
    },
    { status: 410 }
  );
}

export async function GET(request: Request) {
  return POST(request);
}
