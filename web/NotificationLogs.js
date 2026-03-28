function getNotificationLogsSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName("NotificationLogs");
  var headers = [
    "LogID",
    "CreatedAt",
    "TaskID",
    "ProviderID",
    "ProviderPhone",
    "Category",
    "Area",
    "ServiceTime",
    "TemplateName",
    "Status",
    "StatusCode",
    "MessageId",
    "ErrorMessage",
    "RawResponse",
  ];

  if (!sh) {
    sh = ss.insertSheet("NotificationLogs");
  }

  ensureSheetHeaders_(sh, headers);
  return sh;
}

function getNextNotificationLogIds_(count) {
  var total = Number(count || 0) || 0;
  if (total <= 0) return [];
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var currentValue = String(props.getProperty("NOTIFICATION_LOG_SEQ") || "").trim();
    var currentSeq = Number(currentValue) || 0;

    if (!currentSeq) {
      var sh = getNotificationLogsSheet_();
      var values = sh.getDataRange().getValues();
      for (var i = 1; i < values.length; i++) {
        var logId = String(values[i][0] || "").trim();
        var match = logId.match(/^LOG-(\d+)$/i);
        if (!match) continue;
        var seq = Number(match[1]) || 0;
        if (seq > currentSeq) currentSeq = seq;
      }
    }

    var ids = [];
    for (var j = 0; j < total; j++) {
      currentSeq += 1;
      ids.push("LOG-" + ("0000" + currentSeq).slice(-4));
    }

    props.setProperty("NOTIFICATION_LOG_SEQ", String(currentSeq));
    return ids;
  } finally {
    lock.releaseLock();
  }
}

function hasNotificationLogsForTask_(taskId) {
  var normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) return false;

  var sh = getNotificationLogsSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) return false;

  for (var i = 1; i < values.length; i++) {
    if (String(values[i][2] || "").trim() === normalizedTaskId) {
      return true;
    }
  }

  return false;
}

function appendNotificationLog_(log) {
  var logStartMs = Date.now();
  var sh = getNotificationLogsSheet_();
  var precomputedLogId = String(log && log.LogID || log && log.logId || "").trim();
  var logId = precomputedLogId || getNextNotificationLogIds_(1)[0];
  var createdAt = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
  var row = [
    logId,
    createdAt,
    String(log && log.TaskID || log && log.taskId || "").trim(),
    String(log && log.ProviderID || log && log.providerId || "").trim(),
    String(log && log.ProviderPhone || log && log.providerPhone || "").trim(),
    String(log && log.Category || log && log.category || "").trim(),
    String(log && log.Area || log && log.area || "").trim(),
    String(log && log.ServiceTime || log && log.serviceTime || "").trim(),
    String(log && log.TemplateName || log && log.templateName || "").trim(),
    String(log && log.Status || log && log.status || "").trim(),
    Number(log && log.StatusCode || log && log.statusCode || 0) || "",
    String(log && log.MessageId || log && log.messageId || "").trim(),
    String(log && log.ErrorMessage || log && log.errorMessage || "").trim(),
    String(log && log.RawResponse || log && log.rawResponse || "").trim(),
  ];

  sh.appendRow(row);

  Logger.log(
    "appendNotificationLog_ timing | logId=%s | taskId=%s | providerId=%s | elapsedMs=%s",
    logId,
    String(log && log.TaskID || log && log.taskId || "").trim(),
    String(log && log.ProviderID || log && log.providerId || "").trim(),
    Date.now() - logStartMs
  );

  return {
    ok: true,
    logId: logId,
    createdAt: createdAt,
  };
}

function getNotificationSummaryByTask_(taskId) {
  var normalizedTaskId = String(taskId || "").trim();
  var taskLookup = typeof getTaskDisplayLookup_ === "function" ? getTaskDisplayLookup_() : {};
  var sh = getNotificationLogsSheet_();
  var values = sh.getDataRange().getValues();
  var summary = {
    taskId: normalizedTaskId,
    DisplayID:
      taskLookup &&
      taskLookup[normalizedTaskId] &&
      String(taskLookup[normalizedTaskId].DisplayID || "").trim(),
    total: 0,
    accepted: 0,
    failed: 0,
    error: 0,
    latestCreatedAt: "",
  };

  if (!normalizedTaskId || values.length <= 1) {
    return summary;
  }

  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    if (String(row[2] || "").trim() !== normalizedTaskId) continue;

    var status = String(row[9] || "").trim().toLowerCase();
    var createdAt = String(row[1] || "").trim();

    summary.total++;
    if (status === "accepted") summary.accepted++;
    if (status === "failed") summary.failed++;
    if (status === "error") summary.error++;
    if (createdAt) summary.latestCreatedAt = createdAt;
  }

  return summary;
}

function getRecentNotificationLogs_(limit) {
  var maxItems = Math.max(1, Number(limit || 20) || 20);
  var taskLookup = typeof getTaskDisplayLookup_ === "function" ? getTaskDisplayLookup_() : {};
  var sh = getNotificationLogsSheet_();
  var values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];

  var rows = [];
  for (var i = values.length - 1; i >= 1 && rows.length < maxItems; i--) {
    var row = values[i] || [];
    rows.push({
      LogID: String(row[0] || "").trim(),
      CreatedAt: String(row[1] || "").trim(),
      TaskID: String(row[2] || "").trim(),
      DisplayID:
        taskLookup &&
        taskLookup[String(row[2] || "").trim()] &&
        String(taskLookup[String(row[2] || "").trim()].DisplayID || "").trim(),
      ProviderID: String(row[3] || "").trim(),
      ProviderPhone: String(row[4] || "").trim(),
      Category: String(row[5] || "").trim(),
      Area: String(row[6] || "").trim(),
      ServiceTime: String(row[7] || "").trim(),
      TemplateName: String(row[8] || "").trim(),
      Status: String(row[9] || "").trim(),
      StatusCode: row[10] || "",
      MessageId: String(row[11] || "").trim(),
      ErrorMessage: String(row[12] || "").trim(),
      RawResponse: String(row[13] || "").trim(),
    });
  }

  return rows;
}
