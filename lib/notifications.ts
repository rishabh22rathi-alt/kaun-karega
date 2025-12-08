import { normalizePhone } from "./utils/phone";

export const whatsappToken = process.env.META_WA_TOKEN;
export const whatsappPhoneId = process.env.META_WA_PHONE_ID;
export const templateName = process.env.META_WA_TEMPLATE_OTP; // e.g., "kk_otp"
export const templateLanguage = "en"; // must match template language in WhatsApp Business

export function ensureWhatsAppConfig() {
  if (!whatsappToken || !whatsappPhoneId || !templateName) {
    console.error("WhatsApp config missing:", {
      hasToken: !!whatsappToken,
      hasPhoneId: !!whatsappPhoneId,
      templateName,
    });
    throw new Error("Missing WhatsApp configuration (token/phoneId/templateName).");
  }

  return { whatsappToken, whatsappPhoneId, templateName };
}

type WhatsAppComponent = {
  type: "body" | "button";
  parameters: { type: "text"; text: string }[];
  sub_type?: "url";
  index?: string;
};

export async function sendWhatsappTemplate(
  phone: string,
  template: string,
  components: WhatsAppComponent[]
) {
  const { whatsappToken, whatsappPhoneId } = ensureWhatsAppConfig();

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template" as const,
    template: {
      name: template,
      language: { code: templateLanguage },
      components,
    },
  };

  console.log("[WA] Sending template message", { phone, template, payload });

  const response = await fetch(
    `https://graph.facebook.com/v21.0/${whatsappPhoneId}/messages`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${whatsappToken}`,
      },
      body: JSON.stringify(payload),
    }
  );

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const details = data?.error?.error_data?.details;

    console.error("[WA] Error response from WhatsApp API", {
      status: response.status,
      message: data?.error?.message,
      code: data?.error?.code,
      details,
      raw: data,
    });

    throw new Error(details || data?.error?.message || "WhatsApp API error");
  }

  console.log("[WA] WhatsApp API success", data);
  return data;
}

export async function sendOtpMessage(phone: string, otp: string) {
  const { templateName } = ensureWhatsAppConfig();
  const normalized = normalizePhone(phone);

  if (!normalized) throw new Error("Invalid phone number");
  if (!otp) throw new Error("OTP is empty");

  const components: WhatsAppComponent[] = [
    // 1) BODY COMPONENT – for {{1}} in the body
    {
      type: "body",
      parameters: [
        { type: "text", text: otp }, // {{1}} in body
      ],
    },

    // 2) BUTTON COMPONENT – for {{1}} in the URL button
    {
      type: "button",
      sub_type: "url",
      index: "0", // first button in your template
      parameters: [
        { type: "text", text: otp }, // {{1}} in button URL
        // Or some token / id you want in the URL instead of OTP
      ],
    },
  ];

  console.log("Sending WhatsApp OTP template:", {
    templateName,
    normalized,
    components,
  });

  return await sendWhatsappTemplate(normalized, templateName, components);
}


