import {
  createChatRoom,
  getTaskById,
} from "@/lib/googleSheets";
import { sendWhatsappText } from "@/lib/notifications";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const taskId = url.searchParams.get("taskId") || "";

  if (!taskId) {
    return Response.json({ ok: false, error: "taskId required" }, { status: 400 });
  }

  try {
    const task = await getTaskById(taskId);
    if (!task) {
      return Response.json(
        { ok: false, error: "Task not found" },
        { status: 404 }
      );
    }
    return Response.json({ ok: true, task });
  } catch (error) {
    console.error("Get task error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

type RespondPayload = {
  taskId?: string;
  providerPhone?: string;
};

export async function POST(req: Request) {
  try {
    const { taskId, providerPhone }: RespondPayload = await req.json();

    if (!taskId || !providerPhone) {
      return Response.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const task = await getTaskById(taskId);
    if (!task) {
      return Response.json(
        { ok: false, error: "Task not found" },
        { status: 404 }
      );
    }

    const { roomId } = await createChatRoom({
      taskId,
      userPhone: task.userPhone,
      providerPhone,
    });

    const message = [
      "Kaun Karega Aapka Kaam?",
      "",
      "Ek service provider ne aapke request ka jawab diya hai!",
      "",
      "Chat kholne ke liye click karein:",
      `https://kaunkarega.com/chat/${roomId}`,
    ].join("\n");

    try {
      await sendWhatsappText(task.userPhone, message);
    } catch (err) {
      console.error("Failed to notify user of response:", err);
    }

    return Response.json({ ok: true, roomId });
  } catch (error) {
    console.error("Respond error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
