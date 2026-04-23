type TemplateParameter = {
  type: "text";
  text: string;
};

type ButtonComponent = {
  type: "button";
  sub_type: "url";
  index: string;
  parameters: TemplateParameter[];
};

type SendTemplateInput = {
  phone: string;
  templateName: string;
  languageCode?: string;
  bodyParameters?: TemplateParameter[];
  buttonParameters?: ButtonComponent[];
};

export type SendTemplateResult = {
  ok: boolean;
  status: "accepted" | "failed" | "error";
  statusCode: number | null;
  messageId: string;
  errorMessage: string;
  responseText: string;
  data: unknown;
  templateName: string;
};

function getConfig() {
  const token =
    process.env.META_WA_TOKEN ||
    process.env.META_WA_ACCESS_TOKEN ||
    process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId =
    process.env.META_WA_PHONE_ID ||
    process.env.META_WA_PHONE_NUMBER_ID ||
    process.env.WHATSAPP_PHONE_ID;

  if (!token || !phoneId) {
    throw new Error("Missing required env vars for WhatsApp template sends");
  }

  return { token, phoneId };
}

function normalizeWhatsAppPhone(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("91") && digits.length > 10) {
    return digits;
  }
  if (digits.length === 10) {
    return `91${digits}`;
  }
  return digits;
}

export async function sendWhatsAppTemplate(
  input: SendTemplateInput
): Promise<SendTemplateResult> {
  const templateName = String(input.templateName || "").trim();
  const toPhone = normalizeWhatsAppPhone(String(input.phone || ""));
  const languageCode = String(input.languageCode || "en").trim() || "en";

  if (!templateName) {
    throw new Error("Missing WhatsApp template name");
  }

  if (!toPhone || !/^91[6-9]\d{9}$/.test(toPhone)) {
    return {
      ok: false,
      status: "failed",
      statusCode: null,
      messageId: "",
      errorMessage: "Invalid WhatsApp mobile number",
      responseText: "Invalid WhatsApp mobile number",
      data: null,
      templateName,
    };
  }

  const { token, phoneId } = getConfig();
  const components: Array<{ type: string; parameters?: TemplateParameter[]; sub_type?: string; index?: string }> = [];

  if (Array.isArray(input.bodyParameters) && input.bodyParameters.length > 0) {
    components.push({
      type: "body",
      parameters: input.bodyParameters,
    });
  }

  if (Array.isArray(input.buttonParameters)) {
    for (const button of input.buttonParameters) {
      components.push(button);
    }
  }

  const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: toPhone,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components,
      },
    }),
  });

  const responseText = await response.text();
  let data: unknown = null;
  try {
    data = responseText ? (JSON.parse(responseText) as unknown) : null;
  } catch {
    data = null;
  }

  const messageId =
    data &&
    typeof data === "object" &&
    Array.isArray((data as { messages?: Array<{ id?: unknown }> }).messages)
      ? String((data as { messages?: Array<{ id?: unknown }> }).messages?.[0]?.id || "").trim()
      : "";

  const errorMessage =
    data &&
    typeof data === "object" &&
    (data as { error?: { message?: unknown } }).error &&
    typeof (data as { error?: { message?: unknown } }).error?.message !== "undefined"
      ? String((data as { error?: { message?: unknown } }).error?.message || "").trim()
      : "";

  const ok = response.ok && !errorMessage;
  return {
    ok,
    status: ok ? "accepted" : errorMessage ? "failed" : "error",
    statusCode: response.status,
    messageId,
    errorMessage,
    responseText,
    data,
    templateName,
  };
}

export async function sendUserFirstProviderMessageNotification(
  userPhone: string,
  displayId: string,
  threadId: string
): Promise<SendTemplateResult> {
  return sendWhatsAppTemplate({
    phone: userPhone,
    templateName: "user_chat_first_provider_message",
    languageCode: "en",
    bodyParameters: [{ type: "text", text: String(displayId || "").trim() || "-" }],
    buttonParameters: [
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: String(threadId || "").trim() }],
      },
    ],
  });
}

export async function sendProviderUserRepliedNotification(
  providerPhone: string,
  displayId: string,
  threadId: string
): Promise<SendTemplateResult> {
  return sendWhatsAppTemplate({
    phone: providerPhone,
    templateName: "provider_user_replied_message",
    languageCode: "en",
    bodyParameters: [{ type: "text", text: String(displayId || "").trim() || "-" }],
    buttonParameters: [
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: String(threadId || "").trim() }],
      },
    ],
  });
}
