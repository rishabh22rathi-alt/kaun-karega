// lib/whatsapp-provider.ts
// Server-side helper for sending provider lead alert via Meta WhatsApp Cloud API.
// Do NOT import this in client components.

function getConfig() {
  const token = process.env.META_WA_TOKEN;
  const phoneId = process.env.META_WA_PHONE_ID;
  if (!token || !phoneId) {
    throw new Error(
      "Missing required env vars: META_WA_TOKEN and/or META_WA_PHONE_ID"
    );
  }
  return { token, phoneId };
}

export async function sendProviderLeadMessage(
  toPhoneNumber: string,
  kaamLabel: string,
  serviceTime: string,
  area: string,
  buttonSuffix: string
): Promise<unknown> {
  const { token, phoneId } = getConfig();
  const templateName =
    process.env.META_WA_PROVIDER_LEAD_TEMPLATE || "provider_job_alert";

  const payload = {
    messaging_product: "whatsapp",
    to: toPhoneNumber,
    type: "template",
    template: {
      name: templateName,
      language: { code: "en" },
      components: [
        {
          type: "body",
          parameters: [
            { type: "text", text: kaamLabel.replace(/^Kaam No\.\s*/i, "").trim() || kaamLabel },
            { type: "text", text: serviceTime },
            { type: "text", text: area },
          ],
        },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: buttonSuffix }],
        },
      ],
    },
  };

  console.log("[whatsapp-provider] sending", {
    to: toPhoneNumber,
    templateName,
    payload,
  });

  const response = await fetch(
    `https://graph.facebook.com/v19.0/${phoneId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json();

  console.log("[whatsapp-provider] meta response", {
    to: toPhoneNumber,
    status: response.status,
    data,
  });

  if (!response.ok) {
    throw new Error(
      `WhatsApp API error ${response.status}: ${
        (data as { error?: { message?: string } }).error?.message ?? "unknown"
      }`
    );
  }

  return data;
}
