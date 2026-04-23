import { requireAdminSession } from "@/lib/adminAuth";
import { getProviderByIdFromSupabase } from "@/lib/admin/adminProviderReads";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!id) {
    return Response.json({ ok: false, error: "Missing provider id" }, { status: 400 });
  }

  try {
    const provider = await getProviderByIdFromSupabase(id);
    if (!provider) {
      return Response.json({ ok: false, error: "Provider not found" }, { status: 404 });
    }
    return Response.json(provider);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load provider";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
