import { getChatRoom, getMessages } from "@/lib/googleSheets";

type ListPayload = {
  roomId?: string;
};

export async function POST(req: Request) {
  try {
    const { roomId }: ListPayload = await req.json();

    if (!roomId) {
      return Response.json(
        { ok: false, error: "Missing roomId" },
        { status: 400 }
      );
    }

    const chatRoom = await getChatRoom(roomId);

    if (!chatRoom) {
      return Response.json({ ok: false, error: "Chat not found" }, { status: 404 });
    }

    const messages = await getMessages(roomId);
    const expired = chatRoom.expiresAt
      ? Date.now() > new Date(chatRoom.expiresAt).getTime()
      : false;

    return Response.json({ ok: true, messages, expired, chatRoom });
  } catch (error) {
    console.error("List messages error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
