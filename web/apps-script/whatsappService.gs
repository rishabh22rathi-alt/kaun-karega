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
    "📢 Kaun Karega Aapka Kaam?\n\n" +
    "🛠 Category: " + task.category + "\n" +
    "📍 Location: " + task.area + "\n" +
    "📝 Details: " + task.details + "\n" +
    "⏱ Required: " + task.urgency + "\n\n" +
    "Agar aap yeh kaam kar sakte hain, niche diye gaye link par click karein:\n" +
    responseLink +
    "\n\n- Kaun Karega";

  try {
    // Placeholder: replace with actual WhatsApp integration.
    Logger.log("Sending WhatsApp to " + provider.phone + " => " + message);
  } catch (err) {
    throw new Error("WhatsApp send failed: " + err);
  }
}
