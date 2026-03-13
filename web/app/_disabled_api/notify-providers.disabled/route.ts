import { saveTaskProviderRow } from "@/lib/googleSheets";
import { sendWhatsappTemplate } from "@/lib/notifications";
import { normalizePhone } from "@/lib/utils/phone";

type ProviderEntry = {
  providerId?: string;
  phone?: string;
};

type NotifyPayload = {
  taskId?: string;
  category?: string;
  time?: string;
  area?: string;
  providers?: ProviderEntry[];
  userPhone?: string;
};

export async function POST(req: Request) {
  try {
    const { taskId, category, time, area, providers }: NotifyPayload =
      await req.json();

    if (!taskId || !category || !area || !Array.isArray(providers)) {
      return Response.json(
        { ok: false, error: "Missing required fields" },
        { status: 400 }
      );
    }

    let sent = 0;
    const description = time ? `Needed: ${time}` : "New task available";

    for (const provider of providers) {
      const providerId = provider.providerId?.trim();
      const providerPhone = normalizePhone(provider.phone || "");
      if (!providerId || !providerPhone) continue;

      const chatUrl = `https://kaunkarega.com/chat?taskId=${encodeURIComponent(
        taskId
      )}&provider=${encodeURIComponent(providerPhone)}`;

      const components = [
        {
          type: "body" as const,
          parameters: [
            {
              type: "text" as const,
              text: `${category} | ${area} | ${description}`,
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
        await saveTaskProviderRow({
          taskId,
          providerId,
          providerPhone,
        });
        await sendWhatsappTemplate(
          providerPhone,
          "kk_job_notification",
          components
        );
        sent += 1;
      } catch (err) {
        console.error(
          `Failed to notify provider ${providerPhone} for task ${taskId}:`,
          err
        );
      }
    }

    return Response.json({ ok: true, sent });
  } catch (error) {
    console.error("Notify providers error:", error);
    return Response.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
