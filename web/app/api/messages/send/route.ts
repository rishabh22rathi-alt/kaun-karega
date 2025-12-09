import { addMessage, getChatRoom } from "@/lib/googleSheets";

type SendPayload = {
  roomId?: string;
  sender?: "user" | "provider" | string;
  message?: string;
};

export async function POST(req: Request) {
  try {
    const { roomId, sender, message }: SendPayload = await req.json();

    if (!roomId || !sender || !message?.trim()) {
      return Response.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const chatRoom = await getChatRoom(roomId);
    if (!chatRoom) {
      return Response.json({ ok: false, error: "Chat not found" }, { status: 404 });
    }

    const now = Date.now();
    const expired = chatRoom.expiresAt
      ? now > new Date(chatRoom.expiresAt).getTime()
      : false;

    if (expired) {
      return Response.json({ ok: false, expired: true }, { status: 400 });
    }

    await addMessage({ roomId, sender, message: message.trim() });

    return Response.json({ ok: true });
  } catch (error) {
    console.error("Send message error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
