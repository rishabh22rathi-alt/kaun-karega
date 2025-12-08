import { getAllCommunityRequests } from "@/lib/googleSheets";

export async function GET() {
  try {
    const community = await getAllCommunityRequests();
    return Response.json({ ok: true, community });
  } catch (error) {
    console.error("Admin community error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
