import { getAllReviews } from "@/lib/googleSheets";

export async function GET() {
  try {
    const reviews = await getAllReviews();
    return Response.json({ ok: true, reviews });
  } catch (error) {
    console.error("Admin reviews error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return GET();
}
