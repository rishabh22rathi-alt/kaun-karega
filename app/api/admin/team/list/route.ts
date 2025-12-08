import { getAllTeamMembers } from "@/lib/googleSheets";

export async function GET() {
  try {
    const members = await getAllTeamMembers();
    return Response.json({ ok: true, members });
  } catch (error) {
    console.error("Admin team list error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
