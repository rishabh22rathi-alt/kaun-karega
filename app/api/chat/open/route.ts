import { NextRequest, NextResponse } from "next/server";
import { createChatRoom, getChatRoom, getTaskById } from "@/lib/googleSheets";
import { normalizePhone } from "@/lib/utils/phone";

type Payload = {
  taskId?: string;
  provider?: string;
};

async function resolveRoom(taskId: string, provider: string) {
  const normalizedProvider = normalizePhone(provider);
  if (!normalizedProvider) {
    throw new Error("Invalid provider phone");
  }

  const task = await getTaskById(taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  const normalizedUser = normalizePhone(task.userPhone || "");
  if (!normalizedUser) {
    throw new Error("Invalid user phone");
  }

  const roomId = `${taskId}-${normalizedProvider}`;
  const existing = await getChatRoom(roomId);
  if (!existing) {
    await createChatRoom({
      taskId,
      userPhone: normalizedUser,
      providerPhone: normalizedProvider,
    });
  }

  return roomId;
}

export async function POST(req: Request) {
  try {
    const { taskId, provider }: Payload = await req.json();
    if (!taskId || !provider) {
      return NextResponse.json(
        { ok: false, error: "taskId and provider are required" },
        { status: 400 }
      );
    }

    const roomId = await resolveRoom(taskId, provider);
    return NextResponse.json({ ok: true, roomId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const search = req.nextUrl.searchParams;
  const taskId = search.get("taskId") || "";
  const provider = search.get("provider") || "";

  if (!taskId || !provider) {
    return NextResponse.json(
      { ok: false, error: "taskId and provider are required" },
      { status: 400 }
    );
  }

  try {
    const roomId = await resolveRoom(taskId, provider);
    return NextResponse.json({ ok: true, roomId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
