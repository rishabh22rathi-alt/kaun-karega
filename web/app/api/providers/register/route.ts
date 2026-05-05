import { NextResponse } from "next/server";

// Disabled: this route used to call Apps Script `providers/register`. The
// active path is POST /api/kk action="provider_register" which writes to
// Supabase `providers`, `provider_services`, `provider_areas`. Returning
// 410 Gone fails closed.
function gone() {
  return NextResponse.json(
    {
      ok: false,
      error: "Legacy route disabled. Use /api/kk action=provider_register.",
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
