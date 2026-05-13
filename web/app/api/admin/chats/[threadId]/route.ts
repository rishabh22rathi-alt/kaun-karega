import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import {
  getAdminChatThreadDetail,
  type AdminChatThreadType,
} from "@/lib/admin/adminChats";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/admin/chats/[threadId]
//
// Admin-gated read of a single thread + its ordered messages. Works
// for both Task chats (chat_threads + chat_messages) and I-Need chats
// (need_chat_threads + need_chat_messages).
//
// Type discovery:
//   - The caller may pass ?type=task or ?type=need to skip discovery.
//   - With no type query, we probe Task first then Need. Thread ids
//     are namespaced enough in practice that exactly one source will
//     match.
//
// Read-only — never mutates either table.

// Next.js 15 wraps the dynamic-segment params in a Promise so the
// router can stream params resolution. The handler awaits it before
// touching threadId.
type RouteContext = {
  params: Promise<{ threadId: string }>;
};

const ALLOWED_TYPES = new Set<AdminChatThreadType>(["task", "need"]);

export async function GET(
  request: Request,
  context: RouteContext
): Promise<NextResponse> {
  const adminCheck = await requireAdminSession(request);
  if (!adminCheck.ok) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 403 }
    );
  }

  const { threadId } = await context.params;
  const rawId = decodeURIComponent(threadId || "").trim();
  if (!rawId) {
    return NextResponse.json(
      { ok: false, error: "ThreadID required" },
      { status: 400 }
    );
  }

  const url = new URL(request.url);
  const typeParam = (url.searchParams.get("type") ?? "")
    .trim()
    .toLowerCase() as AdminChatThreadType;
  const explicitType = ALLOWED_TYPES.has(typeParam) ? typeParam : null;

  try {
    if (explicitType) {
      const detail = await getAdminChatThreadDetail(rawId, explicitType);
      if (!detail) {
        return NextResponse.json(
          { ok: false, error: "Thread not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, ...detail }, { status: 200 });
    }

    // No explicit type — probe task first, then need. Each call is a
    // single PK-style lookup so the cost is fixed.
    const taskDetail = await getAdminChatThreadDetail(rawId, "task");
    if (taskDetail) {
      return NextResponse.json({ ok: true, ...taskDetail }, { status: 200 });
    }
    const needDetail = await getAdminChatThreadDetail(rawId, "need");
    if (needDetail) {
      return NextResponse.json({ ok: true, ...needDetail }, { status: 200 });
    }
    return NextResponse.json(
      { ok: false, error: "Thread not found" },
      { status: 404 }
    );
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Failed to load chat thread",
      },
      { status: 500 }
    );
  }
}
