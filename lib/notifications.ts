import { normalizePhone } from "./utils/phone";

export const whatsappToken = process.env.META_WA_TOKEN;
export const whatsappPhoneId = process.env.META_WA_PHONE_ID;
export const templateName = process.env.META_WA_TEMPLATE_OTP;
export const templateLanguage = "en";

type TextParameter = { type: "text"; text: string };

type BodyComponent = {
  type: "body";
  parameters: TextParameter[];
};

type ButtonComponent = {
  type: "button";
  subtype?: "url";
  sub_type?: "url";
  index: number | string;
  parameters: TextParameter[];
};

type WhatsAppTemplateComponent = BodyComponent | ButtonComponent;
type WhatsAppTemplateComponentPayload =
  | BodyComponent
  | {
      type: "button";
      sub_type: "url";
      index: string;
      parameters: TextParameter[];
    };

type WhatsAppTemplatePayload = {
  messaging_product: "whatsapp";
  to: string;
  type: "template";
  template: {
    name: string;
    language: { code: typeof templateLanguage };
    components: WhatsAppTemplateComponent[];
  };
};

type WhatsAppErrorResponse = {
  error?: {
    message?: string;
    code?: number;
    error_data?: { details?: string };
  };
};

type WhatsAppSuccessResponse = Record<string, unknown>;

export function ensureWhatsAppConfig(): {
  whatsappToken: string;
  whatsappPhoneId: string;
  templateName: string;
} {
  const missing: string[] = [];
  if (!whatsappToken) missing.push("META_WA_TOKEN");
  if (!whatsappPhoneId) missing.push("META_WA_PHONE_ID");
  if (!templateName) missing.push("META_WA_TEMPLATE_OTP");

  if (missing.length > 0) {
    throw new Error(
      `Missing WhatsApp configuration: ${missing.join(", ")}`
    );
  }

  return {
    whatsappToken: whatsappToken as string,
    whatsappPhoneId: whatsappPhoneId as string,
    templateName: templateName as string,
  };
}

export async function sendWhatsappTemplate(
  phone: string,
  template: string,
  components: WhatsAppTemplateComponent[]
): Promise<WhatsAppSuccessResponse> {
  const { whatsappToken: token, whatsappPhoneId: phoneId } =
    ensureWhatsAppConfig();

  const payload: WhatsAppTemplatePayload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: template,
      language: { code: templateLanguage },
      components: components.map<WhatsAppTemplateComponentPayload>(
        (component) => {
          if (component.type === "button") {
            return {
              type: "button",
              sub_type: component.subtype || component.sub_type || "url",
              index: String(component.index),
              parameters: component.parameters,
            };
          }
          return component;
        }
      ),
    },
  };

  const response = await fetch(
    `https://graph.facebook.com/v20.0/${phoneId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  let data: WhatsAppSuccessResponse | WhatsAppErrorResponse | undefined;
  try {
    data = (await response.json()) as
      | WhatsAppSuccessResponse
      | WhatsAppErrorResponse;
  } catch {
    data = undefined;
  }

  if (!response.ok) {
    const errorPayload = data as WhatsAppErrorResponse | undefined;
    const message =
      errorPayload?.error?.error_data?.details ||
      errorPayload?.error?.message ||
      `WhatsApp API error (${response.status})`;
    throw new Error(message);
  }

  return (data as WhatsAppSuccessResponse) || {};
}

export async function sendOtpMessage(
  phone: string,
  otp: string
): Promise<WhatsAppSuccessResponse> {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new Error("Invalid phone number");
  }
  if (!otp) {
    throw new Error("OTP is required");
  }

  const components: BodyComponent[] = [
    {
      type: "body",
      parameters: [{ type: "text", text: otp }],
    },
  ];

  const { templateName: name } = ensureWhatsAppConfig();
  return sendWhatsappTemplate(normalized, name, components);
}

export async function sendJobNotification(
  phone: string,
  link: string
): Promise<WhatsAppSuccessResponse> {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new Error("Invalid phone number");
  }
  if (!link) {
    throw new Error("Job link is required");
  }

  const components: WhatsAppTemplateComponent[] = [
    {
      type: "body",
      parameters: [{ type: "text", text: "You have a new job request" }],
    },
    {
      type: "button",
      subtype: "url",
      index: 0,
      parameters: [{ type: "text", text: link }],
    },
  ];

  const { templateName: name } = ensureWhatsAppConfig();
  return sendWhatsappTemplate(normalized, name, components);
}
