import { getAllChatRooms } from "@/lib/googleSheets";

export async function GET() {
  try {
    const chats = await getAllChatRooms();
    return Response.json({ ok: true, chats });
  } catch (error) {
    console.error("Admin chats error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
