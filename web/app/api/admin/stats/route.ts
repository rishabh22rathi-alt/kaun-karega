import { NextResponse } from "next/server";

import { requireAdminSession } from "@/lib/adminAuth";
import { getAdminDashboardStats } from "@/lib/admin/adminDashboardStats";

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await getAdminDashboardStats();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }

  return NextResponse.json({
    ok: result.ok,
    stats: result.stats,
    providers: result.providers,
    categoryApplications: result.categoryApplications,
    categories: result.categories,
  });
}

export async function POST(request: Request) {
  return GET(request);
}
