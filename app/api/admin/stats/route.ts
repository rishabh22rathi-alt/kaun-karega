import { getAdminStats } from "@/lib/googleSheets";

export async function GET() {
  try {
    const stats = await getAdminStats();
    return Response.json({ ok: true, stats });
  } catch (error) {
    console.error("Admin stats error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
