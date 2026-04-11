function sendProviderJobAlert(phone, taskId, serviceTime, area, taskDisplayId, providerId) {
  var sendStartMs = Date.now();
  var scriptProperties = PropertiesService.getScriptProperties();

  var templateName = String(
    scriptProperties.getProperty("META_WA_PROVIDER_LEAD_TEMPLATE") || ""
  ).trim();

  var languageCode = String(
    scriptProperties.getProperty("META_WA_LANG") || "en"
  ).trim();

  var normalizedPhone = String(phone || "").replace(/\D/g, "");

  if (normalizedPhone.indexOf("91") === 0 && normalizedPhone.length > 10) {
    normalizedPhone = normalizedPhone.substring(2);
  }

  if (normalizedPhone.length !== 10 || !/^[6-9]\d{9}$/.test(normalizedPhone)) {
    return {
      ok: false,
      status: "failed",
      statusCode: "",
      messageId: "",
      errorMessage: "Invalid WhatsApp mobile number",
      responseText: "Invalid WhatsApp mobile number",
      data: null
    };
  }

  if (!templateName) {
    throw new Error("Missing META_WA_PROVIDER_LEAD_TEMPLATE in Script Properties");
  }

  var kaamLabel = String(taskDisplayId || "").trim() || String(taskId || "").trim();
  var requiredTime = String(serviceTime || "").trim();
  var requiredArea = String(area || "").trim();

  var sendResult = sendWhatsAppTemplateViaMeta_({
    Phone: phone,
    TemplateName: templateName,
    LanguageCode: languageCode,
    BodyParameters: [
      {
        type: "text",
        text: kaamLabel
      },
      {
        type: "text",
        text: requiredTime
      },
      {
        type: "text",
        text: requiredArea
      }
    ],
    ButtonParameters: [
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [
          {
            type: "text",
            text: String(taskId || "").trim() + "/" + String(providerId || "").trim()
          }
        ]
      }
    ]
  });

  Logger.log(
    "sendProviderJobAlert timing | taskId=%s | phone=%s | status=%s | statusCode=%s | elapsedMs=%s",
    String(taskId || "").trim(),
    String(phone || "").trim(),
    sendResult.status,
    sendResult.statusCode,
    Date.now() - sendStartMs
  );

  Logger.log(sendResult.responseText);
  return {
    ok: sendResult.ok,
    status: sendResult.status,
    statusCode: sendResult.statusCode,
    messageId: sendResult.messageId,
    errorMessage: sendResult.errorMessage,
    responseText: sendResult.responseText,
    data: sendResult.data
  };
}

function testWhatsappTemplate() {
  return sendProviderJobAlert(
    "9509597100",
    "TK-TEST",
    "Tomorrow",
    "Sardarpura",
    "",
    "PR-TEST"
  );
}
