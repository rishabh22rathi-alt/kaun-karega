import { adminSupabase } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

// Public endpoint — homepage search/category suggestions read this.
// Use service-role client to bypass RLS (mirrors /api/areas), and gate to
// active=true so freshly-approved categories show up without code changes.
// Order by `name` (always present) instead of `created_at`, which is not
// guaranteed to exist on this table.
export async function GET() {
  const { data, error } = await adminSupabase
    .from("categories")
    .select("name, active")
    .eq("active", true)
    .order("name", { ascending: true });

  if (error) {
    console.error("[api/categories] fetch failed", error.message || error);
    return NextResponse.json(
      {
        ok: false,
        data: [],
        error: {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        },
      },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    data: data ?? [],
    error: null,
  });
}
