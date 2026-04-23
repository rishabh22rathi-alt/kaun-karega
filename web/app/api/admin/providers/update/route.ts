import { requireAdminSession } from "@/lib/adminAuth";
import { updateProviderInSupabase } from "@/lib/admin/adminProviderReads";

export async function POST(request: Request) {
  const auth = await requireAdminSession(request);
  if (!auth.ok) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid request body" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";
  const categories = Array.isArray(body.categories)
    ? (body.categories as unknown[]).map(String).filter(Boolean)
    : [];
  const areas = Array.isArray(body.areas)
    ? (body.areas as unknown[]).map(String).filter(Boolean)
    : [];

  if (!id) {
    return Response.json({ ok: false, error: "Missing required field: id" }, { status: 400 });
  }

  const result = await updateProviderInSupabase({ id, name, phone, categories, areas });
  return Response.json(result);
}
