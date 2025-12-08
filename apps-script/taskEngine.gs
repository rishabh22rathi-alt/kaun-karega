/**
 * Phase 8: Simple matching and notification engine.
 * Matching rule: provider.categories includes task.category AND provider.areas includes task.area.
 */
var LEAD_STATS_SHEET = "Lead_Stats";
var DISTRIBUTION_LOG_SHEET = "Distribution_Log";
var TASK_RESPONSE_LOG_SHEET = "Task_Response_Log";
var TASKS_SHEET = "Tasks";

function findMatchingProviders(task) {
  var sheet = getSheetByName("Master_Providers");
  var data = sheet.getDataRange().getValues();
  if (!data.length) return [];
  var headers = data[0];
  var rows = data.slice(1);

  var idxName = headerIndex(headers, "Name");
  var idxPhone = headerIndex(headers, "Phone");
  var idxCategory = headerIndex(headers, "Category");
  var idxArea = headerIndex(headers, "Area");
  var idxId = headerIndex(headers, "ProviderID") !== -1 ? headerIndex(headers, "ProviderID") : headerIndex(headers, "ID");

  if (idxCategory === -1 || idxArea === -1 || idxPhone === -1) {
    return [];
  }

  var targetCategory = String(task.category || "").toLowerCase();
  var targetArea = String(task.area || "").toLowerCase();

  return rows
    .map(function (row) {
      var categories = toArray(row[idxCategory]).map(function (c) {
        return c.toLowerCase();
      });
      var areas = toArray(row[idxArea]).map(function (a) {
        return a.toLowerCase();
      });
      var matches =
        categories.indexOf(targetCategory) !== -1 &&
        areas.indexOf(targetArea) !== -1;
      if (!matches) return null;
      return {
        id: idxId !== -1 ? row[idxId] : row[idxPhone],
        name: row[idxName] || "",
        phone: row[idxPhone],
        categories: categories,
        areas: areas,
      };
    })
    .filter(function (item) {
      return item && item.phone;
    });
}

/**
 * Handles provider response (public endpoint).
 */
function handleProviderResponse(e) {
  var taskId = e && e.parameter && e.parameter.taskId;
  var providerId = e && e.parameter && e.parameter.providerId;
  if (!taskId || !providerId) {
    return HtmlService.createHtmlOutput("Missing task or provider information.");
  }

  var task = getTaskById(taskId);
  if (!task) {
    return HtmlService.createHtmlOutput("Task not found.");
  }

  logProviderResponse(taskId, providerId, task.Area, task.Category);

  return HtmlService.createHtmlOutput(
    "<div style='font-family:sans-serif;padding:20px;max-width:480px'>" +
      "<h2>Thank you!</h2>" +
      "<p>Your response has been recorded by Kaun Karega.</p>" +
      "</div>"
  );
}

function notifyProvidersForTask(task) {
  var matches = findMatchingProviders(task);
  var logSheet = getOrCreateSheet(DISTRIBUTION_LOG_SHEET, [
    "TaskID",
    "ProviderID",
    "Area",
    "Category",
    "SentAt",
    "Status",
  ]);

  var now = new Date();
  matches.forEach(function (provider) {
    try {
      sendWhatsAppToProvider(provider, task);
      logSheet.appendRow([
        task.taskId,
        provider.id || provider.phone,
        task.area,
        task.category,
        now,
        "Notified",
      ]);
    } catch (err) {
      logSheet.appendRow([
        task.taskId,
        provider.id || provider.phone,
        task.area,
        task.category,
        now,
        "Failed",
      ]);
    }
  });

  return matches.length;
}

function incrementLeadStats(task) {
  var sheet = getOrCreateSheet(LEAD_STATS_SHEET, ["Date", "Area", "Category", "LeadCount"]);
  var data = sheet.getDataRange().getValues();
  if (data.length === 0) {
    sheet.appendRow(["Date", "Area", "Category", "LeadCount"]);
    data = sheet.getDataRange().getValues();
  }
  var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var foundRow = -1;
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (
      String(row[0]) === today &&
      String(row[1]).toLowerCase() === String(task.area).toLowerCase() &&
      String(row[2]).toLowerCase() === String(task.category).toLowerCase()
    ) {
      foundRow = i + 1; // 1-based including header
      break;
    }
  }

  if (foundRow !== -1) {
    var current = Number(sheet.getRange(foundRow, 4).getValue()) || 0;
    sheet.getRange(foundRow, 4).setValue(current + 1);
  } else {
    sheet.appendRow([today, task.area, task.category, 1]);
  }
}

/**
 * Fetch a task by TaskID from the Tasks sheet.
 */
function getTaskById(taskId) {
  var sheet = getSheetByName(TASKS_SHEET);
  var data = sheet.getDataRange().getValues();
  if (!data.length) return null;
  var headers = data[0];
  var idxId = headerIndex(headers, "TaskID");
  if (idxId === -1) return null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idxId]) === String(taskId)) {
      var obj = {};
      headers.forEach(function (h, idx) {
        obj[h] = data[i][idx];
      });
      return obj;
    }
  }
  return null;
}

/**
 * Log provider acceptance into Task_Response_Log (dedupe by TaskID + ProviderID).
 */
function logProviderResponse(taskId, providerId, area, category) {
  var sheet = getOrCreateSheet(TASK_RESPONSE_LOG_SHEET, [
    "TaskID",
    "ProviderID",
    "Area",
    "Category",
    "ResponseAt",
    "ResponseStatus",
  ]);
  var data = sheet.getDataRange().getValues();
  var headers = data[0];
  var idxTask = headerIndex(headers, "TaskID");
  var idxProv = headerIndex(headers, "ProviderID");

  var targetRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (
      String(data[i][idxTask]) === String(taskId) &&
      String(data[i][idxProv]) === String(providerId)
    ) {
      targetRow = i + 1;
      break;
    }
  }

  var now = new Date();
  if (targetRow !== -1) {
    // Update timestamp/status
    sheet.getRange(targetRow, headerIndex(headers, "ResponseAt") + 1).setValue(now);
    sheet.getRange(targetRow, headerIndex(headers, "ResponseStatus") + 1).setValue("Accepted");
  } else {
    sheet.appendRow([taskId, providerId, area, category, now, "Accepted"]);
  }

  // Optionally update distribution log status
  try {
    var distSheet = getOrCreateSheet(DISTRIBUTION_LOG_SHEET, [
      "TaskID",
      "ProviderID",
      "Area",
      "Category",
      "SentAt",
      "Status",
    ]);
    var distData = distSheet.getDataRange().getValues();
    var dHeaders = distData[0];
    var dTaskIdx = headerIndex(dHeaders, "TaskID");
    var dProvIdx = headerIndex(dHeaders, "ProviderID");
    var dStatusIdx = headerIndex(dHeaders, "Status");
    for (var j = 1; j < distData.length; j++) {
      if (
        String(distData[j][dTaskIdx]) === String(taskId) &&
        String(distData[j][dProvIdx]) === String(providerId)
      ) {
        distSheet.getRange(j + 1, dStatusIdx + 1).setValue("Accepted");
      }
    }
  } catch (err) {
    Logger.log("Distribution log update failed: " + err);
  }
}

/**
 * Returns tasks that have no responses yet based on Task_Response_Log.
 */
function listTasksWithoutResponse() {
  var taskSheet = getSheetByName(TASKS_SHEET);
  var taskData = taskSheet.getDataRange().getValues();
  if (!taskData.length) return [];
  var taskHeaders = taskData[0];
  var taskRows = taskData.slice(1);

  var respSheet = getOrCreateSheet(TASK_RESPONSE_LOG_SHEET, [
    "TaskID",
    "ProviderID",
    "Area",
    "Category",
    "ResponseAt",
    "ResponseStatus",
  ]);
  var respData = respSheet.getDataRange().getValues();
  var respHeaders = respData[0] || [];
  var respTaskIdx = headerIndex(respHeaders, "TaskID");
  var respondedTaskIds = {};
  if (respTaskIdx !== -1) {
    respData.slice(1).forEach(function (row) {
      respondedTaskIds[String(row[respTaskIdx])] = true;
    });
  }

  var distSheet = getOrCreateSheet(DISTRIBUTION_LOG_SHEET, [
    "TaskID",
    "ProviderID",
    "Area",
    "Category",
    "SentAt",
    "Status",
  ]);
  var distData = distSheet.getDataRange().getValues();
  var distHeaders = distData[0];
  var distTaskIdx = headerIndex(distHeaders, "TaskID");
  var distSentAtIdx = headerIndex(distHeaders, "SentAt");

  var tasks = [];
  taskRows.forEach(function (row) {
    var obj = {};
    taskHeaders.forEach(function (h, idx) {
      obj[h] = row[idx];
    });
    var taskId = obj.TaskID;
    if (!taskId) return;
    if (respondedTaskIds[String(taskId)]) return; // has response

    var notifiedRows = distData
      .slice(1)
      .filter(function (dRow) {
        return String(dRow[distTaskIdx]) === String(taskId);
      });
    var firstSentAt = notifiedRows.length
      ? notifiedRows[0][distSentAtIdx]
      : "";

    tasks.push({
      taskId: taskId,
      category: obj.Category,
      area: obj.Area,
      details: obj.Details,
      urgency: obj.Urgency,
      createdAt: obj.CreatedAt,
      firstSentAt: firstSentAt,
      totalProvidersNotified: notifiedRows.length,
    });
  });

  return tasks;
}

/**
 * Resends WhatsApp notifications for a given task ID to all matching providers.
 */
function resendTaskToProviders(taskId) {
  var task = getTaskById(taskId);
  if (!task) {
    throw new Error("Task not found");
  }
  var matches = findMatchingProviders({
    taskId: task.TaskID,
    area: task.Area,
    category: task.Category,
    details: task.Details,
    urgency: task.Urgency,
    actionUrl: task.ActionUrl || "",
  });
  var logSheet = getOrCreateSheet(DISTRIBUTION_LOG_SHEET, [
    "TaskID",
    "ProviderID",
    "Area",
    "Category",
    "SentAt",
    "Status",
  ]);
  var now = new Date();
  matches.forEach(function (provider) {
    try {
      sendWhatsAppToProvider(provider, {
        taskId: task.TaskID,
        area: task.Area,
        category: task.Category,
        details: task.Details,
        urgency: task.Urgency,
        actionUrl: task.ActionUrl || "",
      });
      logSheet.appendRow([
        task.TaskID,
        provider.id || provider.phone,
        task.Area,
        task.Category,
        now,
        "Resent",
      ]);
    } catch (err) {
      logSheet.appendRow([
        task.TaskID,
        provider.id || provider.phone,
        task.Area,
        task.Category,
        now,
        "ResendFailed",
      ]);
    }
  });
  // Track lead attempt
  incrementLeadStats({
    taskId: task.TaskID,
    area: task.Area,
    category: task.Category,
    createdAt: task.CreatedAt,
  });
  return matches.length;
}
