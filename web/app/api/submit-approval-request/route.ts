import { NextResponse } from "next/server";
import { getAuthSession } from "@/lib/auth";
import { adminSupabase } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      rawCategoryInput,
      area,
    } = body || {};

    const session = getAuthSession({
      cookie: request.headers.get("cookie") ?? "",
    });
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!rawCategoryInput || !area) {
      return NextResponse.json(
        { error: "Required fields missing: Category or Area" },
        { status: 400 }
      );
    }

    const { error } = await adminSupabase
      .from("pending_category_requests")
      .insert({
        request_id: `PCR-${crypto.randomUUID()}`,
        provider_id: null,
        provider_name: "System",
        phone: session.phone,
        requested_category: rawCategoryInput.trim(),
        status: "pending",
        created_at: new Date().toISOString(),
      });

    if (error) {
      throw new Error(error.message);
    }

    return NextResponse.json({ ok: true });
  } catch (error: any) {
    console.error("API Route Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
