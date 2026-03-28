/**
 * DEPRECATED: This module is no longer called by any active Backend.js route.
 * All live matching routes (match_providers GET/POST) resolve to ProviderMatching.js:matchProviders_().
 * Do not update verification logic here. Do not delete until confirmed safe to remove.
 *
 * Phase 8: Simple matching and notification engine.
 * Matching rule:
 * - Task.Category exactly matches Providers.Category
 * - Task.Area exactly matches Providers.Area
 * - Verified providers are ranked first
 */

var LEAD_STATS_SHEET = "Lead_Stats";
var DISTRIBUTION_LOG_SHEET = "Distribution_Log";
var TASK_RESPONSE_LOG_SHEET = "Task_Response_Log";
var TASKS_SHEET = "Tasks";
var PROVIDER_TASK_MATCHES_SHEET = "ProviderTaskMatches";

var PROVIDER_TASK_MATCH_HEADERS = [
  "MatchID",
  "TaskID",
  "ProviderID",
  "ProviderPhone",
  "ProviderName",
  "Category",
  "Area",
  "JobDescription",
  "MatchPriority",
  "Status",
  "CreatedAt",
  "AcceptedAt",
];

// Keep lifecycle simple for MVP.
var TASK_STATUS_SUBMITTED = "submitted";
var TASK_STATUS_NOTIFIED = "notified";
var TASK_STATUS_RESPONDED = "responded";

// Canonical task headers used by backend utilities.
// Header lookup below is candidate-based, so it can still read your current Tasks sheet safely.
var TASK_HEADERS = [
  "TaskID",
  "UserPhone",
  "Category",
  "Area",
  "Details",
  "CreatedAt",
  "Status",
  "NotifiedAt",
  "ServiceDate",
  "TimeSlot",
  "RespondedAt",
];

/* ----------------------------- */
/* Helpers                       */
/* ----------------------------- */


function getOrCreateSheet(sheetName, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }
  return sheet;
}

function ensureSheetHeaders_(sheet, headers) {
  var existingLastColumn = Math.max(sheet.getLastColumn(), headers.length);
  var existingHeaders =
    existingLastColumn > 0
      ? sheet.getRange(1, 1, 1, existingLastColumn).getValues()[0]
      : [];

  var needsWrite = false;
  for (var i = 0; i < headers.length; i++) {
    if (String(existingHeaders[i] || "").trim() !== String(headers[i] || "").trim()) {
      needsWrite = true;
      break;
    }
  }

  if (needsWrite || sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }

  return headers;
}

function buildRowFromData_(headers, data) {
  return headers.map(function (header) {
    return Object.prototype.hasOwnProperty.call(data, header) ? data[header] : "";
  });
}

function findRowIndexByValue(sheet, headerName, value) {
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return -1;

  var headers = data[0];
  var idx = findHeaderIndexByCandidates_(headers, [headerName]);
  if (idx === -1) return -1;

  var target = String(value || "").trim();
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idx] || "").trim() === target) {
      return i + 1; // Apps Script row number
    }
  }
  return -1;
}
function normalizeMatchText_(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getSheetByName(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    throw new Error("Sheet not found: " + name);
  }
  return sheet;
}

function findHeaderIndexByCandidates_(headers, candidates) {
  var normalizedHeaders = (headers || []).map(function (h) {
    return normalizeMatchText_(h).replace(/[^a-z0-9]/g, "");
  });

  var normalizedCandidates = (candidates || []).map(function (c) {
    return normalizeMatchText_(c).replace(/[^a-z0-9]/g, "");
  });

  for (var i = 0; i < normalizedCandidates.length; i++) {
    var idx = normalizedHeaders.indexOf(normalizedCandidates[i]);
    if (idx !== -1) return idx;
  }

  return -1;
}

// Safe compatibility helper because many existing functions already call headerIndex(...)
function headerIndex(headers, name) {
  return findHeaderIndexByCandidates_(headers, [name]);
}

function splitNormalizedValues_(value) {
  return String(value || "")
    .split(",")
    .map(function (item) {
      return normalizeMatchText_(item);
    })
    .filter(function (item) {
      return !!item;
    });
}

function cellHasTruthyValue_(value) {
  if (value === true) return true;
  var normalized = normalizeMatchText_(value);
  return (
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "y" ||
    normalized === "1" ||
    normalized === "checked"
  );
}

function isVerifiedValue_(value) {
  var normalized = normalizeMatchText_(value);
  return (
    normalized === "yes" ||
    normalized === "true" ||
    normalized === "1" ||
    normalized === "verified"
  );
}

/* ----------------------------- */
/* Task state helpers            */
/* ----------------------------- */

function upsertTaskRow_(taskPayload) {
  var sheet = getTasksSheet_();
  var headers = ensureSheetHeaders_(sheet, TASK_HEADERS);
  var rowIndex = findRowIndexByValue(sheet, "TaskID", taskPayload.taskId);
  var createdAt = taskPayload.createdAt ? new Date(taskPayload.createdAt) : new Date();

  if (rowIndex === -1) {
    sheet.appendRow(
      buildRowFromData_(headers, {
        TaskID: taskPayload.taskId,
        UserPhone: taskPayload.phone || taskPayload.userPhone || "",
        Category: taskPayload.category || "",
        Area: taskPayload.area || "",
        Details: taskPayload.details || "",
        CreatedAt: createdAt,
        Status: TASK_STATUS_SUBMITTED,
        ServiceDate: taskPayload.serviceDate || "",
        TimeSlot: taskPayload.timeSlot || "",
      })
    );
  } else {
    var statusIdx = headerIndex(headers, "Status");
    if (statusIdx !== -1) {
      var currentStatus = sheet.getRange(rowIndex, statusIdx + 1).getValue();
      if (!currentStatus) {
        sheet.getRange(rowIndex, statusIdx + 1).setValue(TASK_STATUS_SUBMITTED);
      }
    }

    var createdIdx = headerIndex(headers, "CreatedAt");
    if (createdIdx !== -1) {
      var existingCreatedAt = sheet.getRange(rowIndex, createdIdx + 1).getValue();
      if (!existingCreatedAt) {
        sheet.getRange(rowIndex, createdIdx + 1).setValue(createdAt);
      }
    }
  }
}

function setTaskNotified_(taskId, forceTimestamp) {
  var sheet = getTasksSheet_();
  var headers = ensureSheetHeaders_(sheet, TASK_HEADERS);
  var rowIndex = findRowIndexByValue(sheet, "TaskID", taskId);
  if (rowIndex === -1) return false;

  var statusIdx = headerIndex(headers, "Status");
  if (statusIdx === -1) return false;

  var currentStatus = sheet.getRange(rowIndex, statusIdx + 1).getValue();
  if (String(currentStatus).toLowerCase() === TASK_STATUS_RESPONDED) {
    return false;
  }

  if (
    !currentStatus ||
    String(currentStatus).toLowerCase() === TASK_STATUS_SUBMITTED ||
    String(currentStatus).toLowerCase() === TASK_STATUS_NOTIFIED
  ) {
    sheet.getRange(rowIndex, statusIdx + 1).setValue(TASK_STATUS_NOTIFIED);

    var notifiedIdx = findHeaderIndexByCandidates_(headers, [
      "NotifiedAt",
      "notified at",
    ]);
    if (notifiedIdx !== -1) {
      var existingNotifiedAt = sheet.getRange(rowIndex, notifiedIdx + 1).getValue();
      if (forceTimestamp || !existingNotifiedAt) {
        sheet.getRange(rowIndex, notifiedIdx + 1).setValue(new Date());
      }
    }
    return true;
  }

  return false;
}

function updateTaskStatus_(taskId, nextStatus, timestampHeader) {
  var sheet = getTasksSheet_();
  var headers = ensureSheetHeaders_(sheet, TASK_HEADERS);
  var rowIndex = findRowIndexByValue(sheet, "TaskID", taskId);
  if (rowIndex === -1) return false;

  var statusIdx = headerIndex(headers, "Status");
  if (statusIdx === -1) return false;

  var currentStatus = sheet.getRange(rowIndex, statusIdx + 1).getValue();

  if (nextStatus === TASK_STATUS_NOTIFIED) {
    if (currentStatus && String(currentStatus).toLowerCase() !== TASK_STATUS_SUBMITTED) {
      return false;
    }
  }

  if (nextStatus === TASK_STATUS_RESPONDED) {
    if (String(currentStatus).toLowerCase() === TASK_STATUS_RESPONDED) {
      return false;
    }
  }

  sheet.getRange(rowIndex, statusIdx + 1).setValue(nextStatus);

  if (timestampHeader) {
    var tsIdx = findHeaderIndexByCandidates_(headers, [
      timestampHeader,
      timestampHeader.toLowerCase(),
      timestampHeader.replace(/At$/, " at"),
    ]);
    if (tsIdx !== -1) {
      var existingTimestamp = sheet.getRange(rowIndex, tsIdx + 1).getValue();
      if (!existingTimestamp) {
        sheet.getRange(rowIndex, tsIdx + 1).setValue(new Date());
      }
    }
  }

  return true;
}

/* ----------------------------- */
/* Provider matching             */
/* ----------------------------- */

function findMatchingProviders(task) {
  var sheet = getSheetByName("Providers");
  var data = sheet.getDataRange().getValues();
  if (!data || data.length < 2) return [];

  var headers = data[0];
  var rows = data.slice(1);

  var idxProviderId = findHeaderIndexByCandidates_(headers, ["ProviderID", "ID"]);
  var idxProviderName = findHeaderIndexByCandidates_(headers, [
    "ProviderName",
    "Name",
  ]);
  var idxPhone = findHeaderIndexByCandidates_(headers, ["Phone", "ProviderPhone"]);
  var idxCategory = findHeaderIndexByCandidates_(headers, ["Category", "Categories"]);
  var idxArea = findHeaderIndexByCandidates_(headers, ["Area", "Areas"]);
  var idxVerified = findHeaderIndexByCandidates_(headers, ["Verified"]);

  if (
    idxProviderId === -1 ||
    idxProviderName === -1 ||
    idxPhone === -1 ||
    idxCategory === -1 ||
    idxArea === -1
  ) {
    throw new Error("Providers sheet is missing one or more required headers");
  }

  var targetCategory = normalizeMatchText_(task.category);
  var targetArea = normalizeMatchText_(task.area);

  return rows
    .map(function (row) {
      var categoryValue = normalizeMatchText_(row[idxCategory]);
      var areaValue = normalizeMatchText_(row[idxArea]);

      if (categoryValue !== targetCategory || areaValue !== targetArea) {
        return null;
      }

      var verified = idxVerified !== -1 ? isVerifiedValue_(row[idxVerified]) : false;

      return {
        id: String(row[idxProviderId] || "").trim(),
        name: String(row[idxProviderName] || "").trim(),
        phone: String(row[idxPhone] || "").trim(),
        category: String(row[idxCategory] || "").trim(),
        area: String(row[idxArea] || "").trim(),
        verified: verified,
      };
    })
    .filter(function (item) {
      return item && item.phone;
    })
    .sort(function (a, b) {
      if (a.verified !== b.verified) {
        return a.verified ? -1 : 1;
      }
      return String(a.name).localeCompare(String(b.name));
    });
}

/* ----------------------------- */
/* Task lookup                   */
/* ----------------------------- */

function getTaskById(taskId) {
  var sheet = getTasksSheet_();
  var data = sheet.getDataRange().getValues();
  if (!data || !data.length) return null;

  var headers = data[0];
  var idxId = findHeaderIndexByCandidates_(headers, ["TaskID"]);
  if (idxId === -1) return null;

  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idxId] || "").trim() === String(taskId || "").trim()) {
      var obj = {};
      headers.forEach(function (h, idx) {
        obj[h] = data[i][idx];
      });
      return obj;
    }
  }

  return null;
}

/* ----------------------------- */
/* Match row creation            */
/* ----------------------------- */

function createProviderMatches(taskId) {
  var normalizedTaskId = String(taskId || "").trim();
  if (!normalizedTaskId) {
    throw new Error("Missing taskId");
  }

  var taskSheet = getSheetByName("Tasks");
  var taskValues = taskSheet.getDataRange().getValues();
  if (!taskValues || taskValues.length < 2) {
    throw new Error("Tasks sheet is empty");
  }

  var taskHeaders = taskValues[0];
  var idxTaskId = findHeaderIndexByCandidates_(taskHeaders, ["TaskID"]);
  var idxCategory = findHeaderIndexByCandidates_(taskHeaders, ["Category"]);
  var idxArea = findHeaderIndexByCandidates_(taskHeaders, ["Area"]);
  var idxDetails = findHeaderIndexByCandidates_(taskHeaders, [
    "Details",
    "JobDescription",
  ]);

  if (idxTaskId === -1 || idxCategory === -1 || idxArea === -1 || idxDetails === -1) {
    throw new Error("Tasks sheet is missing one or more required headers");
  }

  var taskRow = null;
  for (var i = 1; i < taskValues.length; i++) {
    if (String(taskValues[i][idxTaskId] || "").trim() === normalizedTaskId) {
      taskRow = taskValues[i];
      break;
    }
  }

  if (!taskRow) {
    throw new Error("Task not found: " + normalizedTaskId);
  }

  var taskCategory = String(taskRow[idxCategory] || "").trim();
  var taskArea = String(taskRow[idxArea] || "").trim();
  var taskDetails = String(taskRow[idxDetails] || "").trim();

  var taskCategoryNorm = normalizeMatchText_(taskCategory);
  var taskAreaNorm = normalizeMatchText_(taskArea);

  if (!taskCategoryNorm || !taskAreaNorm) {
    throw new Error("Task category or area is missing");
  }

  var providerSheet = getSheetByName("Providers");
  var providerValues = providerSheet.getDataRange().getValues();

  var matchSheet = getProviderTaskMatchesSheet_();
  var matchHeaders = ensureSheetHeaders_(matchSheet, PROVIDER_TASK_MATCH_HEADERS);
  var matchValues = matchSheet.getDataRange().getValues();
  var idxMatchTaskId = headerIndex(matchHeaders, "TaskID");

  // Delete old matches for this task first (safe rerun)
  for (var rowIndex = matchValues.length - 1; rowIndex >= 1; rowIndex--) {
    if (String(matchValues[rowIndex][idxMatchTaskId] || "").trim() === normalizedTaskId) {
      matchSheet.deleteRow(rowIndex + 1);
    }
  }

  if (!providerValues || providerValues.length < 2) {
    return 0;
  }

  var providerHeaders = providerValues[0];
  var idxProviderId = findHeaderIndexByCandidates_(providerHeaders, [
    "ProviderID",
    "ID",
  ]);
  var idxProviderPhone = findHeaderIndexByCandidates_(providerHeaders, [
    "Phone",
    "ProviderPhone",
  ]);
  var idxProviderName = findHeaderIndexByCandidates_(providerHeaders, [
    "ProviderName",
    "Name",
  ]);
  var idxProviderCategory = findHeaderIndexByCandidates_(providerHeaders, [
    "Category",
    "Categories",
  ]);
  var idxProviderArea = findHeaderIndexByCandidates_(providerHeaders, [
    "Area",
    "Areas",
  ]);
  var idxProviderVerified = findHeaderIndexByCandidates_(providerHeaders, [
    "Verified",
  ]);

  if (
    idxProviderId === -1 ||
    idxProviderPhone === -1 ||
    idxProviderName === -1 ||
    idxProviderCategory === -1 ||
    idxProviderArea === -1
  ) {
    throw new Error("Providers sheet is missing one or more required headers");
  }

  var matchingProviders = [];

  for (var j = 1; j < providerValues.length; j++) {
    var providerRow = providerValues[j] || [];
    var providerCategoryNorm = normalizeMatchText_(providerRow[idxProviderCategory]);
    var providerAreaNorm = normalizeMatchText_(providerRow[idxProviderArea]);

    if (providerCategoryNorm !== taskCategoryNorm || providerAreaNorm !== taskAreaNorm) {
      continue;
    }

    var verifiedValue =
      idxProviderVerified !== -1
        ? normalizeMatchText_(providerRow[idxProviderVerified])
        : "";
    var matchPriority = isVerifiedValue_(verifiedValue) ? 1 : 2;

    matchingProviders.push({
      providerId: String(providerRow[idxProviderId] || "").trim(),
      providerPhone: String(providerRow[idxProviderPhone] || "").trim(),
      providerName: String(providerRow[idxProviderName] || "").trim(),
      category: taskCategory,
      area: taskArea,
      jobDescription: taskDetails,
      matchPriority: matchPriority,
    });
  }

  matchingProviders.sort(function (a, b) {
    if (a.matchPriority !== b.matchPriority) {
      return a.matchPriority - b.matchPriority;
    }
    if (a.providerName !== b.providerName) {
      return String(a.providerName).localeCompare(String(b.providerName));
    }
    return String(a.providerId).localeCompare(String(b.providerId));
  });

  if (!matchingProviders.length) {
    return 0;
  }

  // Refresh after deletions
  matchValues = matchSheet.getDataRange().getValues();
  var nextMatchId = nextMatchId_(matchHeaders, matchValues);
  var now = new Date();

  var newRows = matchingProviders.map(function (provider) {
    var rowData = {
      MatchID: nextMatchId,
      TaskID: normalizedTaskId,
      ProviderID: provider.providerId,
      ProviderPhone: provider.providerPhone,
      ProviderName: provider.providerName,
      Category: provider.category,
      Area: provider.area,
      JobDescription: provider.jobDescription,
      MatchPriority: provider.matchPriority,
      Status: "new",
      CreatedAt: now,
      AcceptedAt: "",
    };
    nextMatchId = incrementMatchId_(nextMatchId);
    return buildRowFromData_(matchHeaders, rowData);
  });

  matchSheet
    .getRange(matchSheet.getLastRow() + 1, 1, newRows.length, matchHeaders.length)
    .setValues(newRows);

  return newRows.length;
}

/* ----------------------------- */
/* Notification / response       */
/* ----------------------------- */

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
  var successCount = 0;

  matches.forEach(function (provider) {
    try {
      sendWhatsAppToProvider(provider, task);
      successCount += 1;
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

  if (successCount) {
    setTaskNotified_(task.taskId, false);
  }

  return successCount;
}

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
    sheet.getRange(targetRow, headerIndex(headers, "ResponseAt") + 1).setValue(now);
    sheet
      .getRange(targetRow, headerIndex(headers, "ResponseStatus") + 1)
      .setValue("Responded");
  } else {
    sheet.appendRow([taskId, providerId, area, category, now, "Responded"]);
  }

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
        distSheet.getRange(j + 1, dStatusIdx + 1).setValue("Responded");
      }
    }
  } catch (err) {
    Logger.log("Distribution log update failed: " + err);
  }

  updateTaskStatus_(taskId, TASK_STATUS_RESPONDED, "RespondedAt");
}

function listTasksWithoutResponse(minHours) {
  var taskSheet = getTasksSheet_();
  var taskData = taskSheet.getDataRange().getValues();
  if (!taskData || !taskData.length) return [];

  var taskHeaders = taskData[0];
  var taskRows = taskData.slice(1);

  var idxStatus = headerIndex(taskHeaders, "Status");
  var idxRespondedAt = findHeaderIndexByCandidates_(taskHeaders, [
    "RespondedAt",
    "responded at",
  ]);
  var idxNotifiedAt = findHeaderIndexByCandidates_(taskHeaders, [
    "NotifiedAt",
    "notified at",
  ]);

  var hoursThreshold = minHours ? Number(minHours) : 0;

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

    var statusValue = idxStatus !== -1 ? row[idxStatus] : obj.Status;
    var respondedAtValue = idxRespondedAt !== -1 ? row[idxRespondedAt] : "";
    if (String(statusValue).toLowerCase() !== TASK_STATUS_NOTIFIED) return;
    if (respondedAtValue) return;

    var notifiedRows = distData.slice(1).filter(function (dRow) {
      return String(dRow[distTaskIdx]) === String(taskId);
    });

    var firstSentAt = notifiedRows.length ? notifiedRows[0][distSentAtIdx] : "";
    var notifiedAtValue = idxNotifiedAt !== -1 ? row[idxNotifiedAt] : "";
    var effectiveNotifiedAt = notifiedAtValue || firstSentAt;

    if (hoursThreshold > 0) {
      if (!effectiveNotifiedAt) return;
      var notifiedDate = new Date(effectiveNotifiedAt);
      if (isNaN(notifiedDate.getTime())) return;

      var ageHours = (new Date().getTime() - notifiedDate.getTime()) / (60 * 60 * 1000);
      if (ageHours < hoursThreshold) return;
    }

    tasks.push({
      taskId: taskId,
      category: obj.Category,
      area: obj.Area,
      status: statusValue,
      notifiedAt: notifiedAtValue,
      details: obj.Details,
      createdAt: obj.CreatedAt,
      firstSentAt: firstSentAt,
      totalProvidersNotified: notifiedRows.length,
    });
  });

  return tasks;
}

function resendTaskToProviders(taskId) {
  var task = getTaskById(taskId);
  if (!task) {
    throw new Error("Task not found");
  }

  var statusValue = String(task.Status || task.status || "").toLowerCase();
  if (statusValue === TASK_STATUS_RESPONDED) {
    throw new Error("Task already responded; resend is blocked.");
  }

  var matches = findMatchingProviders({
    taskId: task.TaskID,
    area: task.Area,
    category: task.Category,
    details: task.Details,
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
  var successCount = 0;

  matches.forEach(function (provider) {
    try {
      sendWhatsAppToProvider(provider, {
        taskId: task.TaskID,
        area: task.Area,
        category: task.Category,
        details: task.Details,
      });

      successCount += 1;

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

  if (successCount) {
    setTaskNotified_(task.TaskID, true);
  }

  incrementLeadStats({
    taskId: task.TaskID,
    area: task.Area,
    category: task.Category,
    createdAt: task.CreatedAt,
  });

  return successCount;
}

function incrementLeadStats(task) {
  var sheet = getOrCreateSheet(LEAD_STATS_SHEET, [
    "Date",
    "Area",
    "Category",
    "LeadCount",
  ]);

  var data = sheet.getDataRange().getValues();
  if (data.length === 0) {
    sheet.appendRow(["Date", "Area", "Category", "LeadCount"]);
    data = sheet.getDataRange().getValues();
  }

  var today = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    "yyyy-MM-dd"
  );
  var foundRow = -1;

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (
      String(row[0]) === today &&
      String(row[1]).toLowerCase() === String(task.area).toLowerCase() &&
      String(row[2]).toLowerCase() === String(task.category).toLowerCase()
    ) {
      foundRow = i + 1;
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

/* ----------------------------- */
/* Manual test                   */
/* ----------------------------- */

function testCreateProviderMatches() {
  createProviderMatches("TK-1773378503012");
}
