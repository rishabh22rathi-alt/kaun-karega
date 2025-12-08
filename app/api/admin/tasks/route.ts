import { getAllTasksWithStats } from "@/lib/googleSheets";

export async function GET() {
  try {
    const tasks = await getAllTasksWithStats();
    return Response.json({ ok: true, tasks });
  } catch (error) {
    console.error("Admin tasks error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET();
}
