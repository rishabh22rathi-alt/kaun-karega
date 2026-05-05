import { NextResponse } from "next/server";

// Disabled: this route used to fetch categories through Google Apps Script
// via `lib/googleSheets.ts`. The active path is GET /api/categories which
// reads directly from the Supabase `categories` table. Returning 410 Gone
// fails closed.
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "Legacy route disabled. Use /api/categories.",
    },
    { status: 410 }
  );
}
