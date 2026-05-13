import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { listAdminChatThreads } from "@/lib/admin/adminChats";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/chats
//
// Admin monitor feed of chat threads — unions Task chat (chat_threads)
// and I-Need chat (need_chat_threads). READ-ONLY. The endpoint is
// gated by requireAdminSession; non-admin callers get a 403 with no
// payload, so chat metadata is never exposed publicly.
//
// Why a fresh endpoint instead of the existing /api/kk action
// `admin_list_chat_threads`:
//   - This endpoint includes category/area/i-need rows that the
//     legacy action does not expose. Extending the legacy action
//     would change its contract, which other admin surfaces depend on.
//   - REST-style admin endpoints (parallel to /api/admin/kaam,
//     /api/admin/users, etc.) are the new pattern; admin_*
//     /api/kk actions stay around for backwards compatibility but
//     new admin work uses /api/admin/<resource>.
//
// Query params (all optional):
//   ?type=task|need|all   — defaults to "all"
//   ?status=active|closed|flagged|muted|locked
//                          — server-side filter on the normalised
//                          status field; absent = no filter.

const ALLOWED_TYPES = new Set(["task", "need", "all"]);

export async function GET(request: Request): Promise<NextResponse> {
  const adminCheck = await requireAdminSession(request);
  if (!adminCheck.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const typeRaw = (url.searchParams.get("type") ?? "all").toLowerCase();
  const status = (url.searchParams.get("status") ?? "")
    .trim()
    .toLowerCase();
  const type = ALLOWED_TYPES.has(typeRaw)
    ? (typeRaw as "task" | "need" | "all")
    : "all";

  try {
    const result = await listAdminChatThreads({ type, status });
    return NextResponse.json(
      {
        ok: true,
        threads: result.threads,
        stats: result.stats,
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
            : "Failed to load chat threads",
      },
      { status: 500 }
    );
  }
}
