function sendProviderJobAlert(phone, taskId, serviceTime, area, taskDisplayId, providerId) {
  var sendStartMs = Date.now();
  var scriptProperties = PropertiesService.getScriptProperties();

  var accessToken = String(
    scriptProperties.getProperty("WHATSAPP_ACCESS_TOKEN") || ""
  ).trim();

  var phoneNumberId = String(
    scriptProperties.getProperty("META_WA_PHONE_NUMBER_ID") || ""
  ).trim();

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

  if (normalizedPhone.length !== 10) {
    throw new Error("Invalid Indian mobile number: " + phone);
  }

  normalizedPhone = "91" + normalizedPhone;

  if (!accessToken) {
    throw new Error("Missing WHATSAPP_ACCESS_TOKEN in Script Properties");
  }

  if (!phoneNumberId) {
    throw new Error("Missing META_WA_PHONE_NUMBER_ID in Script Properties");
  }

  if (!templateName) {
    throw new Error("Missing META_WA_PROVIDER_LEAD_TEMPLATE in Script Properties");
  }

  var kaamLabel = String(taskDisplayId || "").trim() || String(taskId || "").trim();
  var requiredTime = String(serviceTime || "").trim();
  var requiredArea = String(area || "").trim();

  var apiEndpoint =
    "https://graph.facebook.com/v19.0/" + phoneNumberId + "/messages";

  var payload = {
    messaging_product: "whatsapp",
    to: normalizedPhone,
    type: "template",
    template: {
      name: templateName,
      language: {
        code: languageCode
      },
      components: [
        {
          type: "body",
          parameters: [
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
          ]
        },
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
    }
  };

  var response = UrlFetchApp.fetch(apiEndpoint, {
    method: "post",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var statusCode = response.getResponseCode();
  var responseText = response.getContentText();
  var data = null;
  var messageId = "";
  var errorMessage = "";

  try {
    data = JSON.parse(responseText);
  } catch (err) {
    data = null;
  }

  if (
    data &&
    data.messages &&
    data.messages.length &&
    data.messages[0] &&
    data.messages[0].id
  ) {
    messageId = String(data.messages[0].id).trim();
  }

  if (data && data.error && data.error.message) {
    errorMessage = String(data.error.message).trim();
  }

  var ok = statusCode >= 200 && statusCode < 300 && !(data && data.error);
  var status = ok ? "accepted" : (data && data.error ? "failed" : "error");

  Logger.log(
    "sendProviderJobAlert timing | taskId=%s | phone=%s | status=%s | statusCode=%s | elapsedMs=%s",
    String(taskId || "").trim(),
    String(phone || "").trim(),
    status,
    statusCode,
    Date.now() - sendStartMs
  );

  Logger.log(responseText);
  return {
    ok: ok,
    status: status,
    statusCode: statusCode,
    messageId: messageId,
    errorMessage: errorMessage,
    responseText: responseText,
    data: data
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
