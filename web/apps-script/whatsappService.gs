/**
 * Simple WhatsApp sender for provider notifications.
 * In production, integrate with actual WhatsApp provider.
 * For now, use existing OTP sender pattern or placeholder Logger.
 */
function sendWhatsAppToProvider(provider, task) {
  var baseUrl = "";
  try {
    baseUrl = ScriptApp.getService().getUrl();
  } catch (err) {
    baseUrl = "";
  }
  var responseLink = baseUrl
    ? baseUrl +
      "?path=tasks/providerRespond&taskId=" +
      encodeURIComponent(task.taskId) +
      "&providerId=" +
      encodeURIComponent(provider.id || provider.phone)
    : task.actionUrl || "https://kaunkarega.com/tasks/" + task.taskId;

  var message =
    "Kaun Karega: New task available\n\n" +
    "Category: " + task.category + "\n" +
    "Area: " + task.area + "\n" +
    "Details: " + task.details + "\n" +
    "When: " + task.urgency + "\n\n" +
    "Reply YES on WhatsApp or use this link to respond:\n" +
    responseLink +
    "\n\n- Kaun Karega";

  try {
    // Placeholder: replace with actual WhatsApp integration.
    Logger.log("Sending WhatsApp to " + provider.phone + " => " + message);
  } catch (err) {
    throw new Error("WhatsApp send failed: " + err);
  }
}

function sendProviderRegistrationConfirmation_(phoneRaw, providerId, isVerified) {
  var phone10 = normalizeIndianMobile(phoneRaw);
  if (!phone10) {
    throw new Error("Invalid provider phone for WhatsApp registration confirmation");
  }

  var scriptProps = PropertiesService.getScriptProperties();
  var token = String(scriptProps.getProperty("WHATSAPP_TOKEN") || "").trim();
  var phoneNumberId = String(scriptProps.getProperty("WHATSAPP_PHONE_NUMBER_ID") || "").trim();
  if (!token || !phoneNumberId) {
    throw new Error("Missing WHATSAPP_TOKEN or WHATSAPP_PHONE_NUMBER_ID in Script Properties");
  }

  var body = isVerified
    ? "\u2705 Kaun Karega: Registration successful. You are now VERIFIED. ProviderID: " +
      providerId
    : "\u2705 Kaun Karega: Application submitted. ProviderID: " +
      providerId +
      ". Status: Pending approval (new category request).";

  var payload = {
    messaging_product: "whatsapp",
    to: "91" + phone10,
    type: "text",
    text: {
      body: body,
    },
  };

  var url = "https://graph.facebook.com/v18.0/" + encodeURIComponent(phoneNumberId) + "/messages";
  var response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + token,
    },
    muteHttpExceptions: true,
    payload: JSON.stringify(payload),
  });

  var statusCode = response.getResponseCode();
  if (statusCode < 200 || statusCode >= 300) {
    throw new Error("WhatsApp API returned " + statusCode + ": " + response.getContentText());
  }

  return true;
}
