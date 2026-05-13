import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { buildProvidersUnderReview } from "@/lib/admin/adminProviderReview";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/providers-under-review
//
// Provider-centric review aggregator. Returns one entry per provider
// that has at least one open item across:
//   - pending_category_requests (status='pending')
//   - category_aliases (active=false, submitted_by_provider_id IS NOT NULL)
//   - area_review_queue (status='pending', source_type provider_*)
//
// Read-only. The Approve / Reject / Resolve actions in the UI fan
// out to the existing endpoints — see the inline notes on the
// ProvidersTab buttons. We deliberately keep the payload narrow
// (no message text, no raw row blobs beyond the identifiers the UI
// needs to render and act).
//
// Auth: requireAdminSession.

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  try {
    const result = await buildProvidersUnderReview();
    return NextResponse.json(
      {
        ok: true,
        totalUnderReview: result.providers.length,
        providers: result.providers,
      },
      { status: 200 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to build providers under review",
      },
      { status: 500 }
    );
  }
}
