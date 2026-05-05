import { NextResponse } from "next/server";

// Disabled: this route used to write tasks through Google Apps Script and
// bypassed Supabase entirely. The active path is POST /api/submit-request.
// Returning 410 Gone fails closed instead of silently dropping data.
function gone() {
  return NextResponse.json(
    {
      ok: false,
      error: "Legacy route disabled. Use /api/submit-request.",
    },
    { status: 410 }
  );
}

export async function POST() {
  return gone();
}

export async function GET() {
  return gone();
}
