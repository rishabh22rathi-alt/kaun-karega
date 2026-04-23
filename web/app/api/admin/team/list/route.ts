import { requireAdminSession } from "@/lib/adminAuth";
import { getTeamMembersFromSupabase } from "@/lib/admin/adminTeamMembers";

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await getTeamMembersFromSupabase();
  return Response.json(result, { status: result.ok ? 200 : 500 });
}
