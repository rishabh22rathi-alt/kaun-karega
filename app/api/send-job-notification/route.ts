import { NextRequest, NextResponse } from "next/server";
import { sendWhatsappTemplate } from "@/lib/notifications";
import { normalizePhone } from "@/lib/utils/phone";

type Payload = {
  category?: string;
  area?: string;
  description?: string;
  taskId?: string;
  providerPhones?: string[];
};

export async function POST(req: NextRequest) {
  try {
    const { category, area, description, taskId, providerPhones }: Payload =
      await req.json();

    if (
      !category ||
      !area ||
      !taskId ||
      !Array.isArray(providerPhones) ||
      providerPhones.length === 0
    ) {
      return NextResponse.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    let sent = 0;
    const detail = description || "New task available";

    for (const phone of providerPhones) {
      const normalizedPhone = normalizePhone(phone || "");
      if (!normalizedPhone) continue;

      const chatUrl = `https://kaunkarega.com/chat?taskId=${encodeURIComponent(
        taskId
      )}&provider=${encodeURIComponent(normalizedPhone)}`;

      const components = [
        {
          type: "body" as const,
          parameters: [
            {
              type: "text" as const,
              text: `${category} | ${area} | ${detail}`,
            },
          ],
        },
        {
          type: "button" as const,
          sub_type: "url" as const,
          index: "0",
          parameters: [
            {
              type: "text" as const,
              text: chatUrl,
            },
          ],
        },
      ];

      try {
        await sendWhatsappTemplate(
          normalizedPhone,
          "kk_job_notification",
          components
        );
        sent += 1;
      } catch (err) {
        console.error(
          `Failed to send job notification to ${normalizedPhone}:`,
          err
        );
      }
    }

    return NextResponse.json({ ok: true, sent });
  } catch (error) {
    console.error("send-job-notification error:", error);
    return NextResponse.json(
      { ok: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
