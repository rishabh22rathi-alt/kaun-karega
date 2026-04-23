import { requireAdminSession } from "@/lib/adminAuth";
import { getAdminDashboardStats } from "@/lib/admin/adminDashboardStats";

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await getAdminDashboardStats();
  if (!result.ok) {
    return Response.json({ ok: false, error: result.error }, { status: 500 });
  }

  return Response.json(result);
}

export async function POST(request: Request) {
  return GET(request);
}
