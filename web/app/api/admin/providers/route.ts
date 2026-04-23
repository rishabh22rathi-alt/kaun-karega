import { requireAdminSession } from "@/lib/adminAuth";
import { getAllProvidersFromSupabase } from "@/lib/admin/adminProviderReads";

export async function GET(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const providers = await getAllProvidersFromSupabase();
    return Response.json(providers);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to load providers";
    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
