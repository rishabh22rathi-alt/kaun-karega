import { NextResponse } from "next/server";

// Disabled: this route was a no-op stub from an earlier prototype that
// returned `{ ok: true }` without persisting anything. Returning 410 Gone
// makes any lingering caller fail loudly instead of silently losing data.
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
