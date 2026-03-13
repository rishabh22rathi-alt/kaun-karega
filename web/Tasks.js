/*************************************************
 * TASKS
 *************************************************/
function getTasksSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_TASKS);
  if (!sh) throw new Error("Tasks sheet not found: " + SHEET_TASKS);
  return sh;
}

function makeTaskId_() {
  return "TK-" + Date.now();
}

function submitTask_(data) {
  const phone = normalizePhone10_(data.userPhone || data.phone);
  if (!phone) return { ok: false, status: "error", error: "Invalid phone number" };

  const category = String(data.category || "").trim();
  const area = String(data.area || "").trim();
  const details = String(data.details || data.description || "").trim();

  const serviceDate = String(data.serviceDate || "").trim();
  const timeSlot = String(data.timeSlot || "").trim();

  if (!category) return { ok: false, status: "error", error: "Category required" };
  if (!area) return { ok: false, status: "error", error: "Area required" };

  const sh = getTasksSheet_();

  if (sh.getLastRow() === 0) {
    sh.appendRow([
      "TaskID","UserPhone","Category","Area","Details","Status","CreatedAt",
      "ServiceDate","TimeSlot","notified_at","responded_at"
    ]);
  }

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h).trim());
  const idx = (name) => headers.indexOf(name);

  const taskId = makeTaskId_();
  const createdAt = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");

  const row = new Array(headers.length).fill("");

  row[idx("TaskID")] = taskId;
  row[idx("UserPhone")] = phone;
  row[idx("Category")] = category;
  row[idx("Area")] = area;
  row[idx("Details")] = details;
  row[idx("Status")] = "submitted";
  row[idx("CreatedAt")] = createdAt;

  const iServiceDate = idx("ServiceDate");
  const iTimeSlot = idx("TimeSlot");
  const iNotified = idx("notified_at");
  const iResponded = idx("responded_at");

  if (iServiceDate >= 0) row[iServiceDate] = serviceDate;
  if (iTimeSlot >= 0) row[iTimeSlot] = timeSlot;
  if (iNotified >= 0) row[iNotified] = "";
  if (iResponded >= 0) row[iResponded] = "";

  sh.appendRow(row);

  return { ok: true, status: "success", message: "Task submitted", taskId: taskId };
}

function getUserRequests_(data) {
  const phone = normalizePhone10_(data.userPhone || data.phone);
  if (!phone) return { ok: false, status: "error", error: "Invalid phone number" };

  const sh = getTasksSheet_();
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return { ok: true, status: "success", count: 0, requests: [] };

  const headers = values[0].map((h) => String(h).trim());
  const idx = (name) => headers.indexOf(name);

  const iTaskID = idx("TaskID");
  const iPhone = idx("UserPhone");
  const iCategory = idx("Category");
  const iArea = idx("Area");
  const iDetails = idx("Details");
  const iStatus = idx("Status");
  const iCreated = idx("CreatedAt");
  const iServiceDate = idx("ServiceDate");
  const iTimeSlot = idx("TimeSlot");
  const iNotified = idx("notified_at");
  const iResponded = idx("responded_at");

  if (iPhone === -1) return { ok: false, status: "error", error: 'Missing column "UserPhone"' };

  const out = [];
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    if (String(row[iPhone] || "").trim() !== phone) continue;

    out.push({
      TaskID: iTaskID >= 0 ? row[iTaskID] : "",
      UserPhone: row[iPhone],
      Category: iCategory >= 0 ? row[iCategory] : "",
      Area: iArea >= 0 ? row[iArea] : "",
      Details: iDetails >= 0 ? row[iDetails] : "",
      Status: iStatus >= 0 ? row[iStatus] : "",
      CreatedAt: iCreated >= 0 ? row[iCreated] : "",
      ServiceDate: iServiceDate >= 0 ? row[iServiceDate] : "",
      TimeSlot: iTimeSlot >= 0 ? row[iTimeSlot] : "",
      notified_at: iNotified >= 0 ? row[iNotified] : "",
      responded_at: iResponded >= 0 ? row[iResponded] : "",
    });
  }

  out.sort((a, b) => String(b.TaskID).localeCompare(String(a.TaskID)));
  return { ok: true, status: "success", count: out.length, requests: out };
}

function getAdminTaskSheetState_() {
  const sheet = getTasksSheet_();
  const headers = ensureSheetHeaders_(sheet, [
    "TaskID",
    "UserPhone",
    "Category",
    "Area",
    "Details",
    "Status",
    "CreatedAt",
    "ServiceDate",
    "TimeSlot",
    "notified_at",
    "responded_at",
    "AssignedProvider",
    "ProviderResponseAt",
    "LastReminderAt",
    "CompletedAt",
  ]);
  const values = sheet.getDataRange().getValues();

  return {
    sheet: sheet,
    headers: headers,
    values: values,
    idxTaskId: findHeaderIndexByAliases_(headers, ["TaskID"]),
    idxUserPhone: findHeaderIndexByAliases_(headers, ["UserPhone", "Phone"]),
    idxCategory: findHeaderIndexByAliases_(headers, ["Category"]),
    idxArea: findHeaderIndexByAliases_(headers, ["Area"]),
    idxDetails: findHeaderIndexByAliases_(headers, ["Details", "Description"]),
    idxStatus: findHeaderIndexByAliases_(headers, ["Status"]),
    idxCreatedAt: findHeaderIndexByAliases_(headers, ["CreatedAt"]),
    idxNotifiedAt: findHeaderIndexByAliases_(headers, ["notified_at", "NotifiedAt"]),
    idxRespondedAt: findHeaderIndexByAliases_(headers, ["responded_at", "RespondedAt"]),
    idxAssignedProvider: findHeaderIndexByAliases_(headers, ["AssignedProvider"]),
    idxProviderResponseAt: findHeaderIndexByAliases_(headers, ["ProviderResponseAt"]),
    idxLastReminderAt: findHeaderIndexByAliases_(headers, ["LastReminderAt"]),
    idxCompletedAt: findHeaderIndexByAliases_(headers, ["CompletedAt"]),
  };
}

function parseTaskDateMs_(value) {
  if (!value && value !== 0) return 0;
  if (Object.prototype.toString.call(value) === "[object Date]") {
    const time = value.getTime();
    return isNaN(time) ? 0 : time;
  }

  const raw = String(value || "").trim();
  if (!raw) return 0;

  const parsed = Date.parse(raw);
  if (!isNaN(parsed)) return parsed;

  const match = raw.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/
  );
  if (!match) return 0;

  const day = Number(match[1]) || 1;
  const month = (Number(match[2]) || 1) - 1;
  const year = Number(match[3]) || 1970;
  const hours = Number(match[4] || 0);
  const minutes = Number(match[5] || 0);
  const seconds = Number(match[6] || 0);

  return new Date(year, month, day, hours, minutes, seconds).getTime();
}

function toIsoDateString_(value) {
  const ms = parseTaskDateMs_(value);
  return ms ? new Date(ms).toISOString() : "";
}

function minutesSince_(value) {
  const ms = parseTaskDateMs_(value);
  if (!ms) return 0;
  return Math.max(0, Math.floor((Date.now() - ms) / 60000));
}

function getProviderNameLookup_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_PROVIDERS);
  const byId = {};
  if (!sheet || sheet.getLastRow() < 2) return byId;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const headerMap = getProviderHeaderMap_(headers);

  rows.forEach((row) => {
    const providerId =
      headerMap.providerId !== -1 && row[headerMap.providerId] !== undefined
        ? String(row[headerMap.providerId]).trim()
        : "";
    const providerName =
      headerMap.providerName !== -1 && row[headerMap.providerName] !== undefined
        ? String(row[headerMap.providerName]).trim()
        : "";
    if (!providerId) return;
    byId[providerId] = providerName || providerId;
  });

  return byId;
}

function getTaskMatchSummaries_() {
  const sheet = getProviderTaskMatchesSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return {};

  const headers = values[0] || [];
  const idxTaskId = findHeaderIndexByAliases_(headers, ["TaskID"]);
  const idxProviderId = findHeaderIndexByAliases_(headers, ["ProviderID"]);
  const idxProviderName = findHeaderIndexByAliases_(headers, ["ProviderName"]);
  const idxStatus = findHeaderIndexByAliases_(headers, ["Status"]);
  const idxCreatedAt = findHeaderIndexByAliases_(headers, ["CreatedAt"]);
  const idxAcceptedAt = findHeaderIndexByAliases_(headers, ["AcceptedAt"]);
  const byTaskId = {};

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const taskId = idxTaskId !== -1 && row[idxTaskId] !== undefined ? String(row[idxTaskId]).trim() : "";
    if (!taskId) continue;

    if (!byTaskId[taskId]) {
      byTaskId[taskId] = {
        matchedProviders: [],
        respondedProviderId: "",
        respondedProviderName: "",
        providerResponseAt: "",
      };
    }

    const providerId =
      idxProviderId !== -1 && row[idxProviderId] !== undefined ? String(row[idxProviderId]).trim() : "";
    const providerName =
      idxProviderName !== -1 && row[idxProviderName] !== undefined
        ? String(row[idxProviderName]).trim()
        : "";
    const status =
      idxStatus !== -1 && row[idxStatus] !== undefined ? String(row[idxStatus]).trim().toLowerCase() : "";
    const acceptedAt =
      idxAcceptedAt !== -1 && row[idxAcceptedAt] !== undefined ? toIsoDateString_(row[idxAcceptedAt]) : "";
    const createdAt =
      idxCreatedAt !== -1 && row[idxCreatedAt] !== undefined ? toIsoDateString_(row[idxCreatedAt]) : "";

    if (providerId && byTaskId[taskId].matchedProviders.indexOf(providerId) === -1) {
      byTaskId[taskId].matchedProviders.push(providerId);
    }

    if (
      !byTaskId[taskId].providerResponseAt &&
      (status === "responded" || acceptedAt)
    ) {
      byTaskId[taskId].respondedProviderId = providerId;
      byTaskId[taskId].respondedProviderName = providerName;
      byTaskId[taskId].providerResponseAt = acceptedAt || createdAt;
    }
  }

  return byTaskId;
}

function normalizeAdminRequestStatus_(statusValue, assignedProvider, providerResponseAt, completedAt) {
  if (completedAt) return "COMPLETED";

  const normalizedStatus = String(statusValue || "").trim().toLowerCase();
  if (normalizedStatus === "completed") return "COMPLETED";
  if (normalizedStatus === "assigned" || assignedProvider) return "ASSIGNED";
  if (normalizedStatus === "responded" || providerResponseAt) return "RESPONDED";
  if (normalizedStatus === "notified") return "NOTIFIED";
  if (normalizedStatus === "submitted" || normalizedStatus === "new" || !normalizedStatus) {
    return "NEW";
  }

  return normalizedStatus.toUpperCase();
}

function buildAdminRequests_() {
  const state = getAdminTaskSheetState_();
  const matchSummaries = getTaskMatchSummaries_();
  const providerNames = getProviderNameLookup_();
  const requests = [];

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const taskId =
      state.idxTaskId !== -1 && row[state.idxTaskId] !== undefined
        ? String(row[state.idxTaskId]).trim()
        : "";
    if (!taskId) continue;

    const createdAt =
      state.idxCreatedAt !== -1 && row[state.idxCreatedAt] !== undefined ? row[state.idxCreatedAt] : "";
    const notifiedAt =
      state.idxNotifiedAt !== -1 && row[state.idxNotifiedAt] !== undefined ? row[state.idxNotifiedAt] : "";
    const respondedAt =
      state.idxRespondedAt !== -1 && row[state.idxRespondedAt] !== undefined ? row[state.idxRespondedAt] : "";
    const assignedProvider =
      state.idxAssignedProvider !== -1 && row[state.idxAssignedProvider] !== undefined
        ? String(row[state.idxAssignedProvider]).trim()
        : "";
    const providerResponseAtValue =
      state.idxProviderResponseAt !== -1 && row[state.idxProviderResponseAt] !== undefined
        ? row[state.idxProviderResponseAt]
        : respondedAt;
    const completedAt =
      state.idxCompletedAt !== -1 && row[state.idxCompletedAt] !== undefined ? row[state.idxCompletedAt] : "";
    const lastReminderAt =
      state.idxLastReminderAt !== -1 && row[state.idxLastReminderAt] !== undefined
        ? row[state.idxLastReminderAt]
        : "";
    const matchSummary = matchSummaries[taskId] || {
      matchedProviders: [],
      respondedProviderId: "",
      respondedProviderName: "",
      providerResponseAt: "",
    };
    const providerResponseAt = toIsoDateString_(providerResponseAtValue || matchSummary.providerResponseAt);
    const status = normalizeAdminRequestStatus_(
      state.idxStatus !== -1 && row[state.idxStatus] !== undefined ? row[state.idxStatus] : "",
      assignedProvider,
      providerResponseAt,
      completedAt
    );
    const createdAtIso = toIsoDateString_(createdAt);
    const waitingMinutes = minutesSince_(createdAt);
    const responseWaitingMinutes = minutesSince_(notifiedAt || createdAt);

    requests.push({
      TaskID: taskId,
      UserPhone:
        state.idxUserPhone !== -1 && row[state.idxUserPhone] !== undefined
          ? String(row[state.idxUserPhone]).trim()
          : "",
      Category:
        state.idxCategory !== -1 && row[state.idxCategory] !== undefined
          ? String(row[state.idxCategory]).trim()
          : "",
      Area:
        state.idxArea !== -1 && row[state.idxArea] !== undefined ? String(row[state.idxArea]).trim() : "",
      Details:
        state.idxDetails !== -1 && row[state.idxDetails] !== undefined
          ? String(row[state.idxDetails]).trim()
          : "",
      Status: status,
      RawStatus:
        state.idxStatus !== -1 && row[state.idxStatus] !== undefined
          ? String(row[state.idxStatus]).trim()
          : "",
      CreatedAt: createdAtIso,
      NotifiedAt: toIsoDateString_(notifiedAt),
      AssignedProvider: assignedProvider,
      AssignedProviderName: assignedProvider ? providerNames[assignedProvider] || assignedProvider : "",
      ProviderResponseAt: providerResponseAt,
      RespondedProvider: matchSummary.respondedProviderId,
      RespondedProviderName:
        matchSummary.respondedProviderName ||
        (matchSummary.respondedProviderId
          ? providerNames[matchSummary.respondedProviderId] || matchSummary.respondedProviderId
          : ""),
      LastReminderAt: toIsoDateString_(lastReminderAt),
      CompletedAt: toIsoDateString_(completedAt),
      WaitingMinutes: waitingMinutes,
      ResponseWaitingMinutes: responseWaitingMinutes,
      MatchedProviders: matchSummary.matchedProviders,
    });
  }

  requests.sort((a, b) => parseTaskDateMs_(b.CreatedAt) - parseTaskDateMs_(a.CreatedAt));
  return requests;
}

function getAdminRequestMetrics_(requests) {
  const today = new Date();
  const isSameDay = function (value) {
    const ms = parseTaskDateMs_(value);
    if (!ms) return false;
    const date = new Date(ms);
    return (
      date.getFullYear() === today.getFullYear() &&
      date.getMonth() === today.getMonth() &&
      date.getDate() === today.getDate()
    );
  };

  const respondedDurations = requests
    .filter((request) => request.ProviderResponseAt)
    .map((request) => {
      const createdMs = parseTaskDateMs_(request.CreatedAt);
      const respondedMs = parseTaskDateMs_(request.ProviderResponseAt);
      return createdMs && respondedMs && respondedMs >= createdMs
        ? Math.floor((respondedMs - createdMs) / 60000)
        : 0;
    })
    .filter((value) => value > 0);

  const averageResponseTimeMinutes = respondedDurations.length
    ? Math.round(
        respondedDurations.reduce(function (sum, value) {
          return sum + value;
        }, 0) / respondedDurations.length
      )
    : 0;

  return {
    newRequestsToday: requests.filter((request) => request.Status === "NEW" && isSameDay(request.CreatedAt))
      .length,
    pendingProviderResponse: requests.filter(
      (request) => request.Status === "NOTIFIED" && !request.AssignedProvider
    ).length,
    requestsCompletedToday: requests.filter(
      (request) => request.Status === "COMPLETED" && isSameDay(request.CompletedAt)
    ).length,
    averageResponseTimeMinutes: averageResponseTimeMinutes,
    needsAttentionCount: requests.filter(
      (request) => request.WaitingMinutes > 20 && !request.AssignedProvider && request.Status !== "COMPLETED"
    ).length,
  };
}

function getAdminRequests_(data) {
  const requests = buildAdminRequests_();
  return {
    ok: true,
    status: "success",
    requests: requests,
    metrics: getAdminRequestMetrics_(requests),
  };
}

function updateAdminTaskRow_(taskId, data) {
  const state = getAdminTaskSheetState_();
  for (let i = 1; i < state.values.length; i++) {
    const rowTaskId =
      state.idxTaskId !== -1 && state.values[i][state.idxTaskId] !== undefined
        ? String(state.values[i][state.idxTaskId]).trim()
        : "";
    if (rowTaskId !== String(taskId || "").trim()) continue;

    updateRowFromData_(state.sheet, i + 1, data);
    return { ok: true, rowNumber: i + 1 };
  }

  return { ok: false, status: "error", error: "Task not found" };
}

function remindProviders_(data) {
  const taskId = String(data.taskId || "").trim();
  if (!taskId) return { ok: false, status: "error", error: "TaskID required" };

  const requests = buildAdminRequests_();
  let request = null;
  for (let i = 0; i < requests.length; i++) {
    if (String(requests[i].TaskID).trim() === taskId) {
      request = requests[i];
      break;
    }
  }
  if (!request) return { ok: false, status: "error", error: "Task not found" };

  let matchedProviders = Array.isArray(request.MatchedProviders) ? request.MatchedProviders.slice() : [];
  if (!matchedProviders.length) {
    const matchResult = matchProviders_(request.Category, request.Area, 20);
    if (!matchResult || matchResult.ok === false) {
      return { ok: false, status: "error", error: "Unable to match providers" };
    }

    const providers = Array.isArray(matchResult.providers) ? matchResult.providers : [];
    if (providers.length) {
      const saveResult = saveProviderMatches_({
        taskId: request.TaskID,
        category: request.Category,
        area: request.Area,
        details: request.Details,
        providers: providers,
      });
      if (!saveResult || saveResult.ok === false) {
        return { ok: false, status: "error", error: "Unable to save provider matches" };
      }
      matchedProviders = providers
        .map(function (provider) {
          return String(provider.providerId || provider.ProviderID || provider.id || "").trim();
        })
        .filter(Boolean);
    }
  }

  const now = new Date();
  const updateResult = updateAdminTaskRow_(taskId, {
    Status: "NOTIFIED",
    notified_at: now,
    LastReminderAt: now,
  });
  if (!updateResult.ok) return updateResult;

  return {
    ok: true,
    status: "success",
    taskId: taskId,
    matchedProviders: matchedProviders.length,
    placeholderNotificationTriggered: true,
    reminderAt: now.toISOString(),
  };
}

function assignProvider_(data) {
  const taskId = String(data.taskId || "").trim();
  const providerId = String(data.providerId || "").trim();
  if (!taskId) return { ok: false, status: "error", error: "TaskID required" };
  if (!providerId) return { ok: false, status: "error", error: "ProviderID required" };

  const updateResult = updateAdminTaskRow_(taskId, {
    AssignedProvider: providerId,
    Status: "ASSIGNED",
  });
  if (!updateResult.ok) return updateResult;

  return {
    ok: true,
    status: "success",
    taskId: taskId,
    providerId: providerId,
  };
}

function closeRequest_(data) {
  const taskId = String(data.taskId || "").trim();
  if (!taskId) return { ok: false, status: "error", error: "TaskID required" };

  const now = new Date();
  const updateResult = updateAdminTaskRow_(taskId, {
    Status: "COMPLETED",
    CompletedAt: now,
  });
  if (!updateResult.ok) return updateResult;

  return {
    ok: true,
    status: "success",
    taskId: taskId,
    completedAt: now.toISOString(),
  };
}
