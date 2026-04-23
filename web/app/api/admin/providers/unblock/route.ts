import { requireAdminSession } from "@/lib/adminAuth";
import { setProviderBlockStatus } from "@/lib/admin/adminProviderMutations";

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let id: string;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    id = typeof body.id === "string" ? body.id.trim() : "";
  } catch {
    return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  if (!id) {
    return Response.json({ ok: false, error: "Missing required field: id" }, { status: 400 });
  }

  const result = await setProviderBlockStatus(id, false);
  if (!result) {
    return Response.json({ ok: false, error: "Failed to unblock provider" }, { status: 500 });
  }
  return Response.json(result);
}
