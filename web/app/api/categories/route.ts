import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .select("*")
    .order("created_at", { ascending: true });

  return NextResponse.json({
    ok: true,
    data,
    error: error
      ? {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        }
      : null,
  });
}
