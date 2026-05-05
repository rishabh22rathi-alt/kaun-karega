import { NextResponse } from "next/server";

// Disabled: this route used to dispatch tasks through Google Apps Script
// (`tasks/distribute`). The active path is POST /api/submit-request followed
// by POST /api/process-task-notifications. Returning 410 Gone fails closed.
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
