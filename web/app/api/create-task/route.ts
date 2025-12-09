import {
  findProvidersByCategoryAndArea,
  saveTaskRow,
} from "@/lib/googleSheets";
import { normalizePhone } from "@/lib/utils/phone";

type CreateTaskPayload = {
  phone?: string;
  category?: string;
  time?: string;
  area?: string;
};

export async function POST(req: Request) {
  try {
    const { phone, category, time, area }: CreateTaskPayload = await req.json();

    if (!phone || !category || !time || !area) {
      return Response.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      return Response.json(
        { ok: false, error: "Invalid phone" },
        { status: 400 }
      );
    }

    const taskId = `TASK-${Date.now()}`;

    await saveTaskRow({
      taskId,
      userPhone: normalizedPhone,
      category,
      when: time,
      area,
    });

    const providers = await findProvidersByCategoryAndArea(category, area);

    return Response.json({ ok: true, taskId, providers });
  } catch (error) {
    console.error("Create task error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
