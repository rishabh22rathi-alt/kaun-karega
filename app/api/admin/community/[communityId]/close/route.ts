import { NextRequest, NextResponse } from "next/server";
import { resolveCommunityRequest } from "@/lib/googleSheets";

export async function POST(
  req: NextRequest,
  { params }: { params: { communityId: string } }
) {
  try {
    await resolveCommunityRequest(params.communityId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Admin community resolve error:", error);
    return NextResponse.json(
      { ok: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
