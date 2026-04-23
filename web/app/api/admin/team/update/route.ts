import { requireAdminSession } from "@/lib/adminAuth";
import { updateTeamMemberInSupabase } from "@/lib/admin/adminTeamMembers";

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if (!auth.admin.permissions?.includes("manage_roles")) {
    return Response.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    const role = typeof body?.role === "string" ? body.role.trim() : "admin";
    const permissions = Array.isArray(body?.permissions)
      ? (body.permissions as unknown[]).filter((p) => typeof p === "string").map((p) => String(p).trim())
      : [];
    const active = body?.active !== false;

    if (!phone) {
      return Response.json({ ok: false, error: "Phone is required" }, { status: 400 });
    }

    const result = await updateTeamMemberInSupabase({ phone, role, permissions, active });
    return Response.json(result, { status: result.ok ? 200 : 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal Server Error";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
