import { NextResponse } from "next/server";

// Disabled: this route used to call Apps Script `create_provider_application`.
// Provider registration now flows through POST /api/kk action="provider_register"
// (Supabase). Returning 410 Gone fails closed.
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
