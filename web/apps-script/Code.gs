/**
 * Main router for provider, reviews, and logs APIs.
 * Supports paths:
 *  - GET  /providers/getAll
 *  - GET  /providers/getById?id=PROVIDER_ID
 *  - POST /providers/update
 *  - POST /providers/block
 *  - POST /providers/unblock
 *  - GET  /reviews/getAll
 *  - GET  /logs/getAll
 *  - POST /tasks/distribute
 *  - GET  /tasks/providerRespond (public)
 *  - GET  /tasks/listNoResponse (admin)
 *  - POST /tasks/resend (admin)
 *  - GET  /provider/getDashboard (public)
 *  - GET  /analytics/getLeadStats (admin)
 *  - GET  /analytics/getAreaCategoryMatrix (admin)
 *  - GET  /analytics/getProviderStats (admin)
 */
function doGet(e) {
  try {
    const action =
      e && e.parameter && e.parameter.action ? e.parameter.action : "";
    if (action === "match_providers") {
      var service = (e && e.parameter && (e.parameter.service || e.parameter.category)) || "";
      var area = (e && e.parameter && e.parameter.area) || "";
      var taskId = (e && e.parameter && e.parameter.taskId) || "";
      var userPhone = (e && e.parameter && e.parameter.userPhone) || "";
      var limit = (e && e.parameter && e.parameter.limit) || 20;
      console.log("MATCH_GAS_IN", {
        action: action,
        category: service,
        area: area,
        taskId: taskId,
        userPhone: userPhone,
      });
      return createJsonResponse(matchProviders_(service, area, limit));
    }
    if (action === "get_areas") {
      return json_(getAreas_());
    }
    if (action === "provider_register") {
      return handleProviderRegister_(e && e.parameter ? e.parameter : {});
    }
    if (action === "get_provider_by_phone") {
      return handleGetProviderByPhone_(e && e.parameter ? e.parameter : {});
    }
    if (action === "debug_provider_lookup") {
      return handleDebugProviderLookup_(e && e.parameter ? e.parameter : {});
    }
    if (action === "get_provider_leads") {
      return handleGetProviderLeads_(e && e.parameter ? e.parameter : {});
    }
    if (action === "get_provider_profile") {
      return handleGetProviderProfile_(e && e.parameter ? e.parameter : {});
    }
    return handleRequest(e, "GET");
  } catch (err) {
    return createErrorResponse(err.message);
  }
}

function doPost(e) {
  try {
    var action = e && e.parameter && e.parameter.action;
    var payload = null;
    if (!action) {
      payload = parseJsonBody(e);
      action = payload && payload.action;
    }
    if (action === "match_providers") {
      var matchPayload = payload || parseJsonBody(e);
      var matchService = (matchPayload && (matchPayload.service || matchPayload.category)) || "";
      var matchArea = (matchPayload && matchPayload.area) || "";
      var matchTaskId = (matchPayload && matchPayload.taskId) || "";
      var matchUserPhone = (matchPayload && matchPayload.userPhone) || "";
      var matchLimit = (matchPayload && matchPayload.limit) || 20;
      console.log("MATCH_GAS_IN", {
        action: action,
        category: matchService,
        area: matchArea,
        taskId: matchTaskId,
        userPhone: matchUserPhone,
      });
      return createJsonResponse(matchProviders_(matchService, matchArea, matchLimit));
    }
    if (action === "get_tasks_by_phone") {
      var tasksPayload = payload || parseJsonBody(e);
      return handleGetTasksByPhone_(tasksPayload);
    }
    if (action === "get_sheet_values") {
      var valuesPayload = payload || parseJsonBody(e);
      return handleGetSheetValues_(valuesPayload);
    }
    if (action === "append_sheet_row") {
      var appendPayload = payload || parseJsonBody(e);
      return handleAppendSheetRow_(appendPayload);
    }
    if (action === "update_sheet_row") {
      var updatePayload = payload || parseJsonBody(e);
      return handleUpdateSheetRow_(updatePayload);
    }
    if (action === "submit_task") {
      var submitPayload = payload || parseJsonBody(e);
      return handleSubmitTask_(submitPayload);
    }
    if (action === "get_all_categories") {
      var categories = getAllCategoriesFromSheet_();
      return createJsonResponse({ status: "success", categories: categories });
    }
    if (action === "get_areas") {
      return createJsonResponse(getAreas_());
    }
    if (action === "submit_category_approval") {
      var approvalPayload = payload || parseJsonBody(e);
      return handleSubmitCategoryApproval_(approvalPayload);
    }
    if (action === "request_new_category") {
      var requestCategoryPayload = payload || parseJsonBody(e);
      return handleRequestNewCategory_(requestCategoryPayload);
    }
    if (action === "provider_register") {
      var providerRegisterPayload = payload || parseJsonBody(e);
      return handleProviderRegister_(providerRegisterPayload || {});
    }
    if (action === "save_provider_matches") {
      var saveMatchesPayload = payload || parseJsonBody(e);
      return createJsonResponse(saveProviderMatches_(saveMatchesPayload || {}));
    }
    if (action === "get_provider_by_phone") {
      var byPhonePayload = payload || parseJsonBody(e);
      return handleGetProviderByPhone_(byPhonePayload || {});
    }
    if (action === "debug_provider_lookup") {
      var debugLookupPayload = payload || parseJsonBody(e);
      return handleDebugProviderLookup_(debugLookupPayload || {});
    }
    if (action === "get_provider_leads") {
      var leadsPayload = payload || parseJsonBody(e);
      return handleGetProviderLeads_(leadsPayload || {});
    }
    if (action === "postTask") {
      return handlePostTask_(e);
    }
    return handleRequest(e, "POST");
  } catch (err) {
    return createErrorResponse(err.message);
  }
}

function handleRequest(e, method) {
  var path =
    (e && e.pathInfo) ||
    (e && e.parameter && (e.parameter.path || e.parameter.route)) ||
    "";

  // Public endpoint for provider responses
  if (method === "GET" && path === "tasks/providerRespond") {
    return handleProviderResponse(e);
  }

  // Public endpoint for user task history
  if (method === "GET" && path === "tasks/getUserTasks") {
    var phone = e && e.parameter && e.parameter.phone;
    var tasks = getUserTasksForPhone(phone);
    return createJsonResponse({ tasks: tasks });
  }

  if (method === "POST" && path === "postTask") {
    var postPayload = parseJsonBody(e);
    try {
      var result = handlePostTask(postPayload);
      return createJsonResponse(result);
    } catch (errPost) {
      return createErrorResponse(errPost.message);
    }
  }

  if (method === "GET" && path === "provider/getDashboard") {
    var pid = e && e.parameter && e.parameter.providerId;
    try {
      var dashboard = getProviderDashboardData(pid);
      return createJsonResponse(dashboard);
    } catch (errDash) {
      return createErrorResponse(errDash.message);
    }
  }

  if (!isAuthorized(e, method)) {
    return createUnauthorizedResponse();
  }

  if (method === "GET" && path === "providers/getAll") {
    return createJsonResponse(getAllProviders());
  }

  if (method === "GET" && path === "providers/getById") {
    var pid = e.parameter && e.parameter.id;
    if (!pid) return createErrorResponse("Missing provider id");
    var provider = getProviderById(pid);
    if (!provider) return createErrorResponse("Provider not found");
    return createJsonResponse(provider);
  }

  if (method === "POST" && path === "providers/update") {
    var payload = parseJsonBody(e);
    var result = updateProviderDetails(payload);
    return createJsonResponse(result);
  }

  if (method === "POST" && path === "providers/block") {
    var blockPayload = parseJsonBody(e);
    if (!blockPayload.id) return createErrorResponse("Missing provider id");
    return createJsonResponse(setProviderStatus(blockPayload.id, "Blocked"));
  }

  if (method === "POST" && path === "providers/unblock") {
    var unblockPayload = parseJsonBody(e);
    if (!unblockPayload.id) return createErrorResponse("Missing provider id");
    return createJsonResponse(setProviderStatus(unblockPayload.id, "Active"));
  }

  if (method === "GET" && path === "reviews/getAll") {
    return createJsonResponse(getAllReviews());
  }

  if (method === "GET" && path === "logs/getAll") {
    return createJsonResponse(getAllLogs());
  }

  if (method === "POST" && path === "tasks/distribute") {
    var taskPayload = parseJsonBody(e);
    if (!taskPayload || !taskPayload.taskId || !taskPayload.category || !taskPayload.area) {
      return createErrorResponse("Missing task fields");
    }
    try {
      upsertTaskRow_(taskPayload);
      incrementLeadStats(taskPayload);
      var notified = notifyProvidersForTask(taskPayload);
      return createJsonResponse({
        success: true,
        notifiedProviders: notified,
        warning: notified ? "" : "No matching providers found or notifications failed.",
      });
    } catch (errTask) {
      return createErrorResponse(errTask.message);
    }
  }

  if (method === "GET" && path === "tasks/listNoResponse") {
    try {
      var minHours = e && e.parameter && e.parameter.minHours;
      var tasks = listTasksWithoutResponse(minHours);
      return createJsonResponse({ tasks: tasks });
    } catch (errList) {
      return createErrorResponse(errList.message);
    }
  }

  if (method === "POST" && path === "tasks/resend") {
    var resendPayload = parseJsonBody(e);
    if (!resendPayload || !resendPayload.taskId) {
      return createErrorResponse("Missing taskId");
    }
    try {
      var count = resendTaskToProviders(resendPayload.taskId);
      return createJsonResponse({
        success: true,
        taskId: resendPayload.taskId,
        notifiedProviders: count,
      });
    } catch (errResend) {
      return createErrorResponse(errResend.message);
    }
  }

  if (method === "POST" && path === "tasks/markResponded") {
    var respondedPayload = parseJsonBody(e);
    if (!respondedPayload || !respondedPayload.taskId) {
      return createErrorResponse("Missing taskId");
    }
    try {
      var updated = updateTaskStatus_(
        respondedPayload.taskId,
        TASK_STATUS_RESPONDED,
        "RespondedAt"
      );
      return createJsonResponse({ success: true, updated: updated });
    } catch (errResponded) {
      return createErrorResponse(errResponded.message);
    }
  }

  if (method === "GET" && path === "analytics/getLeadStats") {
    try {
      var leadStats = getLeadStatsData();
      return createJsonResponse(leadStats);
    } catch (errLead) {
      return createErrorResponse(errLead.message);
    }
  }

  if (method === "GET" && path === "analytics/getAreaCategoryMatrix") {
    try {
      var matrix = getAreaCategoryMatrixData();
      return createJsonResponse(matrix);
    } catch (errMatrix) {
      return createErrorResponse(errMatrix.message);
    }
  }

  if (method === "GET" && path === "analytics/getProviderStats") {
    try {
      var providerStats = getProviderStatsData();
      return createJsonResponse(providerStats);
    } catch (errProviderStats) {
      return createErrorResponse(errProviderStats.message);
    }
  }

  return createErrorResponse("Route not found: " + path);
}

function handlePostTask(payload) {
  var phone = payload && payload.phone ? String(payload.phone).trim() : "";
  var category = payload && payload.category ? String(payload.category).trim() : "";
  var area = payload && payload.area ? String(payload.area).trim() : "";

  if (!phone || !category || !area) {
    throw new Error("Missing phone, category, or area");
  }

  var tasksSheet = getTasksSheet_();

  var data = tasksSheet.getDataRange().getValues();
  var headers = data[0] || [];
  var idxCreatedAt = headerIndex(headers, "CreatedAt");
  var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd");
  var todayCount = 0;

  if (data.length > 1 && idxCreatedAt !== -1) {
    for (var i = 1; i < data.length; i++) {
      var cell = data[i][idxCreatedAt];
      if (!cell) continue;
      try {
        var dt = cell instanceof Date ? cell : new Date(cell);
        var dtStr = Utilities.formatDate(dt, Session.getScriptTimeZone(), "yyyyMMdd");
        if (dtStr === todayStr) todayCount++;
      } catch (err) {
        continue;
      }
    }
  }

  var counter = todayCount + 1;
  var taskId = "T-" + todayStr + "-" + ("00" + counter).slice(-3);
  var now = new Date();

  tasksSheet.appendRow(
    buildRowFromData_(headers, {
      TaskID: taskId,
      UserPhone: phone,
      Category: category,
      Area: area,
      Details: payload.details || "",
      Urgency: payload.urgency || "",
      ActionUrl: payload.actionUrl || "",
      CreatedAt: now,
      Status: TASK_STATUS_SUBMITTED,
    })
  );

  var matched = notifyProvidersForTask({
    taskId: taskId,
    category: category,
    area: area,
    details: payload.details || "",
    urgency: payload.urgency || "",
    actionUrl: payload.actionUrl || "",
  });

  return {
    success: true,
    taskId: taskId,
    matchedProviders: matched,
    warning: matched ? "" : "No matching providers found or notifications failed.",
  };
}

/**
 * Public task creation + distribution based on category/area matches.
 */
function handlePostTask_(e) {
  var payload = parseJsonBody(e);
  var category = (payload && payload.category) ? String(payload.category).trim() : "";
  var area = (payload && payload.area) ? String(payload.area).trim() : "";
  var phone = (payload && payload.phone) ? String(payload.phone).trim() : "";

  if (!category || !area || !phone) {
    return createErrorResponse("Missing category, area, or phone");
  }

  var tasksSheet = getTasksSheet_();

  var taskData = tasksSheet.getDataRange().getValues();
  var taskHeaders = taskData[0] || [];
  var idxCreatedAt = headerIndex(taskHeaders, "CreatedAt");
  var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var todayCount = 0;

  if (taskData.length > 1 && idxCreatedAt !== -1) {
    for (var i = 1; i < taskData.length; i++) {
      var createdCell = taskData[i][idxCreatedAt];
      if (!createdCell) continue;
      try {
        var createdDate =
          createdCell instanceof Date ? createdCell : new Date(createdCell);
        var createdStr = Utilities.formatDate(
          createdDate,
          Session.getScriptTimeZone(),
          "yyyy-MM-dd"
        );
        if (createdStr === todayStr) {
          todayCount++;
        }
      } catch (errDate) {
        continue;
      }
    }
  }

  var sequence = todayCount + 1;
  var taskId = "KK-TASK-" + todayStr + "-" + ("00" + sequence).slice(-3);
  var now = new Date();

  tasksSheet.appendRow(
    buildRowFromData_(taskHeaders, {
      TaskID: taskId,
      UserPhone: phone,
      Category: category,
      Area: area,
      Details: payload.details || "",
      Urgency: payload.urgency || "",
      ActionUrl: payload.actionUrl || "",
      CreatedAt: now,
      Status: TASK_STATUS_SUBMITTED,
    })
  );

  var matched = notifyProvidersForTask({
    taskId: taskId,
    category: category,
    area: area,
    details: payload.details || "",
    urgency: payload.urgency || "",
    actionUrl: payload.actionUrl || "",
  });

  return createJsonResponse({
    success: true,
    taskId: taskId,
    matchedProviders: matched,
    warning: matched ? "" : "No matching providers found or notifications failed.",
  });
}

function handleSubmitTask_(payload) {
  var category = (payload && payload.category) ? String(payload.category).trim() : "";
  var area = (payload && payload.area) ? String(payload.area).trim() : "";
  var phone = (payload && payload.phone) ? String(payload.phone).trim() : "";
  var details = (payload && payload.details) ? String(payload.details).trim() : "";
  var urgency = (payload && (payload.urgency || payload.time)) ? String(payload.urgency || payload.time).trim() : "";

  if (!category || !area || !phone) {
    return createErrorResponse("Missing category, area, or phone");
  }

  var tasksSheet = getTasksSheet_();
  var taskData = tasksSheet.getDataRange().getValues();
  var taskHeaders = taskData[0] || [];
  var idxCreatedAt = headerIndex(taskHeaders, "CreatedAt");
  var todayStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  var todayCount = 0;

  if (taskData.length > 1 && idxCreatedAt !== -1) {
    for (var i = 1; i < taskData.length; i++) {
      var createdCell = taskData[i][idxCreatedAt];
      if (!createdCell) continue;
      try {
        var createdDate =
          createdCell instanceof Date ? createdCell : new Date(createdCell);
        var createdStr = Utilities.formatDate(
          createdDate,
          Session.getScriptTimeZone(),
          "yyyy-MM-dd"
        );
        if (createdStr === todayStr) {
          todayCount++;
        }
      } catch (errDate) {
        continue;
      }
    }
  }

  var sequence = todayCount + 1;
  var taskId = (payload && payload.taskId) ? String(payload.taskId).trim() : "KK-TASK-" + todayStr + "-" + ("00" + sequence).slice(-3);
  var now = new Date();

  tasksSheet.appendRow(
    buildRowFromData_(taskHeaders, {
      TaskID: taskId,
      UserPhone: phone,
      Category: category,
      Area: area,
      Details: details,
      Urgency: urgency,
      CreatedAt: now,
      Status: TASK_STATUS_SUBMITTED,
    })
  );

  var notified = notifyProvidersForTask({
    taskId: taskId,
    category: category,
    area: area,
    details: details,
    urgency: urgency,
  });

  return createJsonResponse({
    success: true,
    taskId: taskId,
    notifiedProviders: notified,
    warning: notified ? "" : "No matching providers found or notifications failed.",
  });
}

function handleGetTasksByPhone_(payload) {
  var phone = payload && payload.phone ? String(payload.phone).trim() : "";
  if (!phone) {
    return createErrorResponse("Missing phone");
  }

  var tasksSheet = getTasksSheet_();
  if (!tasksSheet) {
    return createErrorResponse("Tasks sheet not found");
  }

  var rows = tasksSheet.getDataRange().getValues();
  if (!rows || rows.length < 2) {
    return createJsonResponse({ status: "success", tasks: [] });
  }

  var headers = rows[0] || [];
  var idxTaskId = headerIndex(headers, "TaskID");
  var idxCategory = headerIndex(headers, "Category");
  var idxArea = headerIndex(headers, "Area");
  var idxDetails = headerIndex(headers, "Details");
  var idxStatus = headerIndex(headers, "Status");
  var idxCreatedAt = headerIndex(headers, "CreatedAt");
  var idxPhone = headerIndex(headers, "UserPhone");
  if (idxPhone === -1) {
    idxPhone = headerIndex(headers, "Phone");
  }

  var tasks = [];
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i] || [];
    var rowPhone = idxPhone !== -1 ? (row[idxPhone] || "").toString().trim() : "";
    if (rowPhone !== phone) continue;

    tasks.push({
      taskId: idxTaskId !== -1 ? row[idxTaskId] || "" : "",
      category: idxCategory !== -1 ? row[idxCategory] || "" : "",
      area: idxArea !== -1 ? row[idxArea] || "" : "",
      details: idxDetails !== -1 ? row[idxDetails] || "" : "",
      status: idxStatus !== -1 ? row[idxStatus] || "" : "",
      createdAt: idxCreatedAt !== -1 ? row[idxCreatedAt] || "" : "",
    });
  }

  return createJsonResponse({ status: "success", tasks: tasks });
}

function handleGetSheetValues_(payload) {
  var tabName = payload && payload.tabName ? String(payload.tabName).trim() : "";
  var range = payload && payload.range ? String(payload.range).trim() : "";
  if (!tabName) {
    return createErrorResponse("Missing tabName");
  }

  var sheet = getSheetForTab_(tabName);
  var values = range
    ? SpreadsheetApp.getActiveSpreadsheet().getRange(range).getValues()
    : sheet.getDataRange().getValues();

  return createJsonResponse({ values: values });
}

function handleSubmitCategoryApproval_(payload) {
  var rawCategory =
    payload && payload.rawCategoryInput
      ? String(payload.rawCategoryInput).trim()
      : "";
  var bestMatch =
    payload && payload.bestMatch ? String(payload.bestMatch).trim() : "";
  var confidence =
    payload && payload.confidence !== undefined
      ? String(payload.confidence)
      : "";
  var time = payload && payload.time ? String(payload.time).trim() : "";
  var area = payload && payload.area ? String(payload.area).trim() : "";
  var details = payload && payload.details ? String(payload.details).trim() : "";
  var createdAt =
    payload && payload.createdAt ? payload.createdAt : new Date();

  if (!rawCategory || !area) {
    return createErrorResponse("Missing category or area");
  }

  var approvalSheet = getOrCreateSheet("Admin_Approval", [
    "RequestID",
    "RawCategory",
    "BestMatch",
    "Confidence",
    "Time",
    "Area",
    "Details",
    "Status",
    "CreatedAt",
  ]);

  var requestId =
    "APP-" +
    Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyyMMddHHmmss"
    ) +
    "-" +
    Math.floor(Math.random() * 1000);

  approvalSheet.appendRow(
    buildRowFromData_(
      approvalSheet
        .getRange(1, 1, 1, approvalSheet.getLastColumn())
        .getValues()[0] || [],
      {
        RequestID: requestId,
        RawCategory: rawCategory,
        BestMatch: bestMatch,
        Confidence: confidence,
        Time: time,
        Area: area,
        Details: details,
        Status: "Pending",
        CreatedAt: createdAt,
      }
    )
  );

  return createJsonResponse({ status: "success", requestId: requestId });
}

function normalizeRequestedCategory_(value) {
  var cleaned = String(value || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.toLowerCase().replace(/\b[a-z]/g, function (char) {
    return char.toUpperCase();
  });
}

function handleRequestNewCategory_(payload) {
  var phone = payload && payload.phone ? String(payload.phone).trim() : "";
  var name = payload && payload.name ? String(payload.name).trim() : "";
  var requestedCategory = normalizeRequestedCategory_(
    payload && payload.requestedCategory ? payload.requestedCategory : ""
  );
  var source =
    payload && payload.source ? String(payload.source).trim() : "provider_register";
  var ts = payload && payload.ts ? String(payload.ts).trim() : "";

  if (!phone || !requestedCategory) {
    return createErrorResponse("Missing phone or requestedCategory");
  }

  var requestSheet = getOrCreateSheet("CategoryRequests", [
    "RequestID",
    "Phone",
    "Name",
    "RequestedCategory",
    "Status",
    "Source",
    "Date",
    "Time",
  ]);
  var headers = ensureSheetHeaders_(requestSheet, [
    "RequestID",
    "Phone",
    "Name",
    "RequestedCategory",
    "Status",
    "Source",
    "Date",
    "Time",
  ]);

  var rows = requestSheet.getDataRange().getValues();
  var idxRequestId = headerIndex(headers, "RequestID");
  var idxPhone = headerIndex(headers, "Phone");
  var idxRequestedCategory = headerIndex(headers, "RequestedCategory");
  var idxStatus = headerIndex(headers, "Status");

  var requestedKey = requestedCategory.toLowerCase();
  var maxSeq = 0;

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i] || [];
    var rowRequestId =
      idxRequestId !== -1 && row[idxRequestId] !== undefined
        ? String(row[idxRequestId]).trim()
        : "";
    var idMatch = /^CR-(\d+)$/.exec(rowRequestId);
    if (idMatch) {
      var seq = Number(idMatch[1]);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }

    var rowPhone =
      idxPhone !== -1 && row[idxPhone] !== undefined
        ? String(row[idxPhone]).trim()
        : "";
    var rowCategory =
      idxRequestedCategory !== -1 && row[idxRequestedCategory] !== undefined
        ? normalizeRequestedCategory_(row[idxRequestedCategory]).toLowerCase()
        : "";
    var rowStatus =
      idxStatus !== -1 && row[idxStatus] !== undefined
        ? String(row[idxStatus]).trim().toLowerCase()
        : "";

    if (
      rowPhone === phone &&
      rowCategory === requestedKey &&
      rowStatus !== "rejected"
    ) {
      return createJsonResponse({
        ok: true,
        status: "Pending",
        message: "Already requested",
      });
    }
  }

  var nextSeq = maxSeq + 1;
  var requestId = "CR-" + ("0000" + nextSeq).slice(-4);
  var now = ts ? new Date(ts) : new Date();
  if (isNaN(now.getTime())) now = new Date();

  requestSheet.appendRow(
    buildRowFromData_(headers, {
      RequestID: requestId,
      Phone: phone,
      Name: name,
      RequestedCategory: requestedCategory,
      Status: "Pending",
      Source: source || "provider_register",
      Date: Utilities.formatDate(now, Session.getScriptTimeZone(), "yyyy-MM-dd"),
      Time: Utilities.formatDate(now, Session.getScriptTimeZone(), "HH:mm:ss"),
    })
  );

  return createJsonResponse({ ok: true, status: "Pending" });
}

function normalizeCategoryName_(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueNormalizedValues_(values) {
  var list = [];
  var seen = {};
  (values || []).forEach(function (value) {
    var normalized = normalizeCategoryName_(value);
    if (!normalized) return;
    var key = normalized.toLowerCase();
    if (seen[key]) return;
    seen[key] = true;
    list.push(normalized);
  });
  return list;
}

function nextCategoryId_(headers, rows) {
  var idxCategoryId = headerIndex(headers, "CategoryID");
  if (idxCategoryId === -1) {
    return "CAT-0001";
  }

  var maxSeq = 0;
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i] || [];
    var rawId =
      row[idxCategoryId] === undefined ? "" : String(row[idxCategoryId]).trim();
    var match = /^CAT-(\d+)$/i.exec(rawId);
    if (!match) continue;
    var seq = Number(match[1]);
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
  }
  return "CAT-" + ("0000" + (maxSeq + 1)).slice(-4);
}

function ensureCategoriesExist_(categories) {
  var categorySheet = getOrCreateSheet("Categories", [
    "CategoryID",
    "CategoryName",
    "Status",
    "CreatedAt",
  ]);
  var headers = ensureSheetHeaders_(categorySheet, [
    "CategoryID",
    "CategoryName",
    "Status",
    "CreatedAt",
  ]);
  var values = categorySheet.getDataRange().getValues();
  var idxCategoryName =
    headerIndex(headers, "CategoryName") !== -1
      ? headerIndex(headers, "CategoryName")
      : headerIndex(headers, "Category");
  var idxCategoryId = headerIndex(headers, "CategoryID");

  var byKey = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    var name =
      idxCategoryName !== -1 && row[idxCategoryName] !== undefined
        ? normalizeCategoryName_(row[idxCategoryName])
        : "";
    if (!name) continue;
    var key = name.toLowerCase();
    byKey[key] = {
      categoryName: name,
      categoryId:
        idxCategoryId !== -1 && row[idxCategoryId] !== undefined
          ? String(row[idxCategoryId]).trim()
          : "",
    };
  }

  var createdKeys = [];
  var createdRows = [];
  var now = new Date();
  categories.forEach(function (category) {
    var normalized = normalizeCategoryName_(category);
    if (!normalized) return;
    var key = normalized.toLowerCase();
    if (byKey[key]) return;
    var nextId = nextCategoryId_(headers, values.concat(createdRows));
    var rowData = {
      CategoryID: nextId,
      CategoryName: normalized,
      Category: normalized,
      Status: "pending",
      Active: "no",
      CreatedAt: now,
      UpdatedAt: now,
    };
    createdRows.push(buildRowFromData_(headers, rowData));
    byKey[key] = { categoryName: normalized, categoryId: nextId };
    createdKeys.push(key);
  });

  if (createdRows.length) {
    categorySheet
      .getRange(values.length + 1, 1, createdRows.length, headers.length)
      .setValues(createdRows);
  }

  return {
    byKey: byKey,
    createdKeys: createdKeys,
  };
}

function getExistingCategoriesLookup_() {
  var categorySheet = getOrCreateSheet("Categories", [
    "CategoryID",
    "CategoryName",
    "Status",
    "CreatedAt",
  ]);
  var headers = ensureSheetHeaders_(categorySheet, [
    "CategoryID",
    "CategoryName",
    "Status",
    "CreatedAt",
  ]);
  var values = categorySheet.getDataRange().getValues();
  if (!values || values.length < 2) return {};

  var idxCategoryName =
    headerIndex(headers, "CategoryName") !== -1
      ? headerIndex(headers, "CategoryName")
      : headerIndex(headers, "Category");
  var idxCategoryId = headerIndex(headers, "CategoryID");

  var byKey = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    var categoryName =
      idxCategoryName !== -1 && row[idxCategoryName] !== undefined
        ? normalizeCategoryName_(row[idxCategoryName])
        : "";
    if (!categoryName) continue;
    var key = categoryName.toLowerCase();
    if (byKey[key]) continue;
    byKey[key] = {
      categoryName: categoryName,
      categoryId:
        idxCategoryId !== -1 && row[idxCategoryId] !== undefined
          ? String(row[idxCategoryId]).trim()
          : "",
    };
  }
  return byKey;
}

function upsertCategoryApplications_(providerId, providerName, phone, newCategories, now) {
  if (!newCategories || !newCategories.length) return;

  var sheet = getOrCreateSheet("CategoryApplications", [
    "Timestamp",
    "ProviderID",
    "ProviderName",
    "Phone",
    "Category",
    "Status",
  ]);
  var headers = ensureSheetHeaders_(sheet, [
    "Timestamp",
    "ProviderID",
    "ProviderName",
    "Phone",
    "Category",
    "Status",
  ]);
  var values = sheet.getDataRange().getValues();

  var idxProviderId = headerIndex(headers, "ProviderID");
  var idxCategory = headerIndex(headers, "Category");
  var idxStatus = headerIndex(headers, "Status");

  var pendingKeys = {};
  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    var existingProviderId =
      idxProviderId !== -1 && row[idxProviderId] !== undefined
        ? String(row[idxProviderId]).trim()
        : "";
    var existingCategory =
      idxCategory !== -1 && row[idxCategory] !== undefined
        ? normalizeCategoryName_(row[idxCategory]).toLowerCase()
        : "";
    var existingStatus =
      idxStatus !== -1 && row[idxStatus] !== undefined
        ? String(row[idxStatus]).trim().toLowerCase()
        : "";
    if (existingProviderId && existingCategory && existingStatus === "pending") {
      pendingKeys[existingProviderId + "|" + existingCategory] = true;
    }
  }

  var rowsToAppend = [];
  for (var j = 0; j < newCategories.length; j++) {
    var category = normalizeCategoryName_(newCategories[j]);
    if (!category) continue;
    var dedupeKey = String(providerId) + "|" + category.toLowerCase();
    if (pendingKeys[dedupeKey]) continue;

    rowsToAppend.push(
      buildRowFromData_(headers, {
        Timestamp: now || new Date(),
        ProviderID: providerId,
        ProviderName: providerName,
        Phone: phone,
        Category: category,
        Status: "pending",
      })
    );
  }

  if (rowsToAppend.length) {
    sheet
      .getRange(values.length + 1, 1, rowsToAppend.length, headers.length)
      .setValues(rowsToAppend);
  }
}

function normalizeStringArray_(value) {
  if (Array.isArray(value)) {
    return value
      .map(function (item) {
        return String(item || "").replace(/\s+/g, " ").trim();
      })
      .filter(function (item) {
        return !!item;
      });
  }
  if (value === undefined || value === null) return [];
  var raw = String(value).trim();
  if (!raw) return [];
  try {
    var parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return normalizeStringArray_(parsed);
  } catch (err) {
    // Fallback to comma split for non-JSON payloads.
  }
  return raw
    .split(",")
    .map(function (item) {
      return String(item || "").replace(/\s+/g, " ").trim();
    })
    .filter(function (item) {
      return !!item;
    });
}

function parseBoolean_(value) {
  if (value === true || value === false) return value;
  var normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function upsertMappingRows_(sheetName, requiredHeaders, keyField, keyValue, newRowsData) {
  var sheet = getOrCreateSheet(sheetName, requiredHeaders);
  var headers = ensureSheetHeaders_(sheet, requiredHeaders);
  var values = sheet.getDataRange().getValues();
  var keyIndex = headerIndex(headers, keyField);

  var keptRows = [headers];
  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    var rowKey =
      keyIndex !== -1 && row[keyIndex] !== undefined
        ? String(row[keyIndex]).trim()
        : "";
    if (rowKey !== String(keyValue)) {
      keptRows.push(row);
    }
  }

  for (var j = 0; j < newRowsData.length; j++) {
    keptRows.push(buildRowFromData_(headers, newRowsData[j]));
  }

  sheet.clearContents();
  sheet.getRange(1, 1, keptRows.length, headers.length).setValues(keptRows);
}

function nextProviderId_(headers, rows) {
  var idxProviderId =
    headerIndex(headers, "ProviderID") !== -1
      ? headerIndex(headers, "ProviderID")
      : headerIndex(headers, "ID");
  var maxSeq = 0;
  if (idxProviderId !== -1) {
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i] || [];
      var rawId = row[idxProviderId] !== undefined ? String(row[idxProviderId]).trim() : "";
      var match = /^PR-(\d+)$/i.exec(rawId);
      if (!match) continue;
      var seq = Number(match[1]);
      if (!isNaN(seq) && seq > maxSeq) maxSeq = seq;
    }
  }
  return "PR-" + ("0000" + (maxSeq + 1)).slice(-4);
}

function normalizeIndianMobile(phoneRaw) {
  var digits = String(phoneRaw || "").replace(/\D/g, "");
  if (!digits) return "";
  var phone10 = digits.length > 10 ? digits.slice(-10) : digits;
  return phone10.length === 10 ? phone10 : "";
}

function getProvidersSheetAndHeaders_() {
  var sheet = getOrCreateSheet("Providers", [
    "ProviderID",
    "Name",
    "Phone",
    "Category",
    "Areas",
    "Verified",
    "Status",
    "ApprovalStatus",
    "CustomCategory",
    "CreatedAt",
    "UpdatedAt",
  ]);
  var headers = ensureSheetHeaders_(sheet, [
    "ProviderID",
    "Name",
    "Phone",
    "Category",
    "Areas",
    "Verified",
    "Status",
    "ApprovalStatus",
    "CustomCategory",
    "CreatedAt",
    "UpdatedAt",
  ]);
  return { sheet: sheet, headers: headers };
}

function normalizeProviderHeaderKey_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findHeaderIndexByAliases_(headers, aliases) {
  var normalizedAliases = (aliases || []).map(function (alias) {
    return normalizeProviderHeaderKey_(alias);
  });
  for (var i = 0; i < headers.length; i++) {
    var key = normalizeProviderHeaderKey_(headers[i]);
    if (normalizedAliases.indexOf(key) !== -1) return i;
  }
  return -1;
}

function getProviderHeaderMap_(headers) {
  return {
    providerId: findHeaderIndexByAliases_(headers, ["ProviderID", "providerid"]),
    providerName: findHeaderIndexByAliases_(headers, [
      "ProviderName",
      "Name",
      "Provider",
      "providername",
    ]),
    phone: findHeaderIndexByAliases_(headers, [
      "Phone",
      "ProviderPhone",
      "UserPhone",
      "phone",
    ]),
    verified: findHeaderIndexByAliases_(headers, ["Verified", "verified", "IsVerified"]),
  };
}

function buildProviderFromRow_(row, headerMap, headers) {
  var idxProviderId = headerMap.providerId;
  var idxProviderName = headerMap.providerName;
  var idxPhone = headerMap.phone;
  var idxVerified = headerMap.verified;

  var providerId =
    idxProviderId !== -1 && row[idxProviderId] !== undefined
      ? String(row[idxProviderId]).trim()
      : "";
  var providerName =
    idxProviderName !== -1 && row[idxProviderName] !== undefined
      ? String(row[idxProviderName]).trim()
      : "";
  var providerPhone =
    idxPhone !== -1 && row[idxPhone] !== undefined ? String(row[idxPhone]).trim() : "";
  var providerVerified =
    idxVerified !== -1 && row[idxVerified] !== undefined
      ? String(row[idxVerified]).trim()
      : "no";

  return {
    provider: {
      ProviderID: providerId,
      ProviderName: providerName,
      Phone: providerPhone,
      Verified: providerVerified,
      Services: getProviderServices_(providerId),
      Areas: getProviderAreas_(providerId),
    },
    extracted: {
      ProviderID: providerId,
      ProviderName: providerName,
      Verified: providerVerified,
    },
  };
}

function getProviderRowByPhone_(phoneRawFromQuery) {
  var phone10 = normalizeIndianMobile(phoneRawFromQuery);
  if (!phone10) return -1;

  var sheetBundle = getProvidersSheetAndHeaders_();
  var sheet = sheetBundle.sheet;
  var headers = sheetBundle.headers;
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return -1;
  var rows = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();

  var headerMap = getProviderHeaderMap_(headers);
  var idxPhone = headerMap.phone;
  if (idxPhone === -1) return -1;

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i] || [];
    var sheetPhoneRaw =
      idxPhone !== -1 && row[idxPhone] !== undefined ? String(row[idxPhone]) : "";
    var rowPhone10 = normalizeIndianMobile(sheetPhoneRaw);
    if (rowPhone10 === phone10) return i + 2;
  }
  return -1;
}

function getProviderServices_(providerId) {
  if (!providerId) return [];
  var sheet = getOrCreateSheet("ProviderServices", [
    "ProviderID",
    "Phone",
    "Category",
    "CategoryName",
    "CategoryID",
    "Status",
    "CreatedAt",
  ]);
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];

  var headers = values[0] || [];
  var idxProviderId = headerIndex(headers, "ProviderID");
  var idxCategory =
    headerIndex(headers, "CategoryName") !== -1
      ? headerIndex(headers, "CategoryName")
      : headerIndex(headers, "Category");
  var idxStatus = headerIndex(headers, "Status");
  if (idxProviderId === -1 || idxCategory === -1) return [];

  var seen = {};
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    if (String(row[idxProviderId] || "").trim() !== String(providerId)) continue;
    if (idxStatus !== -1) {
      var status = String(row[idxStatus] || "").trim().toLowerCase();
      if (status && status !== "active") continue;
    }
    var category = String(row[idxCategory] || "").replace(/\s+/g, " ").trim();
    if (!category) continue;
    var key = category.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push({ Category: category });
  }
  return out;
}

function getProviderAreas_(providerId) {
  if (!providerId) return [];
  var sheet = getOrCreateSheet("ProviderAreas", [
    "ProviderID",
    "Phone",
    "Area",
    "Status",
    "CreatedAt",
  ]);
  var values = sheet.getDataRange().getValues();
  if (!values.length) return [];

  var headers = values[0] || [];
  var idxProviderId = headerIndex(headers, "ProviderID");
  var idxArea = headerIndex(headers, "Area");
  var idxStatus = headerIndex(headers, "Status");
  if (idxProviderId === -1 || idxArea === -1) return [];

  var seen = {};
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    if (String(row[idxProviderId] || "").trim() !== String(providerId)) continue;
    if (idxStatus !== -1) {
      var status = String(row[idxStatus] || "").trim().toLowerCase();
      if (status && status !== "active") continue;
    }
    var area = String(row[idxArea] || "").replace(/\s+/g, " ").trim();
    if (!area) continue;
    var key = area.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    out.push({ Area: area });
  }
  return out;
}

function handleGetProviderByPhone_(payload) {
  var phoneRaw = payload && payload.phone ? payload.phone : "";
  var phone10 = normalizeIndianMobile(phoneRaw);
  if (!phone10) {
    return createJsonResponse({ ok: false, error: "INVALID_PHONE" });
  }

  var rowNumber = getProviderRowByPhone_(phone10);
  if (rowNumber === -1) {
    return createJsonResponse({ ok: false, error: "PROVIDER_NOT_FOUND", phone: phone10 });
  }

  var sheetBundle = getProvidersSheetAndHeaders_();
  var sheet = sheetBundle.sheet;
  var headers = sheetBundle.headers || [];
  var row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0] || [];
  var headerMap = getProviderHeaderMap_(headers);
  var built = buildProviderFromRow_(row, headerMap, headers);
  var provider = built.provider;

  if (!provider || !provider.ProviderID || !provider.ProviderName) {
    return createJsonResponse({
      ok: false,
      error: "PROVIDER_BUILD_FAILED",
      debug: {
        phone10: phone10,
        providerRow: rowNumber,
        providersSheetName: sheet.getName(),
        headers: headers,
        extracted: built.extracted,
      },
    });
  }

  return createJsonResponse({ ok: true, provider: provider });
}

function handleDebugProviderLookup_(payload) {
  var phoneRaw = payload && payload.phone ? payload.phone : "";
  var phone10 = normalizeIndianMobile(phoneRaw);
  var sheetBundle = getProvidersSheetAndHeaders_();
  var sheet = sheetBundle.sheet;
  var headers = sheetBundle.headers || [];
  var lastRow = sheet.getLastRow();
  var foundRow = phone10 ? getProviderRowByPhone_(phone10) : -1;
  var rowValuesPreview = [];
  if (foundRow !== -1) {
    rowValuesPreview = sheet.getRange(foundRow, 1, 1, headers.length).getValues()[0] || [];
  }

  return createJsonResponse({
    ok: true,
    phone10: phone10,
    providersSheetName: sheet.getName(),
    lastRow: lastRow,
    headers: headers,
    foundRow: foundRow,
    rowValuesPreview: rowValuesPreview,
  });
}

function handleGetProviderLeads_(payload) {
  var providerId = payload && payload.providerId ? String(payload.providerId).trim() : "";
  return createJsonResponse({
    ok: true,
    providerId: providerId,
    leads: [],
  });
}

function handleProviderRegister_(payload) {
  var phone10 = normalizeIndianMobile(payload && payload.phone ? payload.phone : "");
  var phone = phone10;
  var name = payload && payload.name ? String(payload.name).trim() : "";
  var categories = normalizeStringArray_(payload && payload.categories);
  var pendingNewCategories = normalizeStringArray_(
    payload && payload.pendingNewCategories
  );
  var areas = normalizeStringArray_(payload && payload.areas);
  var customCategory = normalizeRequestedCategory_(
    payload && payload.customCategory ? payload.customCategory : ""
  );
  var submittedCategories = uniqueNormalizedValues_(
    categories.concat(pendingNewCategories).concat(customCategory ? [customCategory] : [])
  );

  if (!phone || !name) {
    return createErrorResponse("Missing phone or name");
  }
  if (!areas.length) {
    return createErrorResponse("Missing service areas");
  }
  if (!submittedCategories.length) {
    return createErrorResponse("Missing service categories");
  }
  if (submittedCategories.length > 3) {
    return createErrorResponse("Max 3 service categories allowed");
  }

  var providerSheet = getOrCreateSheet("Providers", [
    "ProviderID",
    "Name",
    "Phone",
    "Category",
    "Areas",
    "Verified",
    "Status",
    "ApprovalStatus",
    "CustomCategory",
    "CreatedAt",
    "UpdatedAt",
  ]);
  var providerHeaders = ensureSheetHeaders_(providerSheet, [
    "ProviderID",
    "Name",
    "Phone",
    "Category",
    "Areas",
    "Verified",
    "Status",
    "ApprovalStatus",
    "CustomCategory",
    "CreatedAt",
    "UpdatedAt",
  ]);
  var providerRows = providerSheet.getDataRange().getValues();

  var idxPhone = headerIndex(providerHeaders, "Phone");
  var idxProviderId =
    headerIndex(providerHeaders, "ProviderID") !== -1
      ? headerIndex(providerHeaders, "ProviderID")
      : headerIndex(providerHeaders, "ID");

  var existingRowNumber = -1;
  var providerId = "";
  for (var i = 1; i < providerRows.length; i++) {
    var row = providerRows[i] || [];
    var rowPhone =
      idxPhone !== -1 && row[idxPhone] !== undefined
        ? normalizeIndianMobile(String(row[idxPhone]))
        : "";
    if (rowPhone === phone) {
      existingRowNumber = i + 1;
      if (idxProviderId !== -1 && row[idxProviderId] !== undefined) {
        providerId = String(row[idxProviderId]).trim();
      }
      break;
    }
  }
  if (!providerId) {
    providerId = nextProviderId_(providerHeaders, providerRows);
  }

  var categoriesLookup = getExistingCategoriesLookup_();
  var newCategories = [];
  submittedCategories.forEach(function (category) {
    var normalized = normalizeCategoryName_(category);
    var key = normalized.toLowerCase();
    if (!normalized) return;
    if (!categoriesLookup[key]) {
      newCategories.push(normalized);
    }
  });
  var requiresApproval = newCategories.length > 0;

  var now = new Date();
  var status = "Active";
  var approvalStatus = requiresApproval ? "pending" : "approved";
  var verified = requiresApproval ? "no" : "yes";

  var providerData = {
    ProviderID: providerId,
    Name: name,
    Phone: phone,
    Category: submittedCategories.join(", "),
    Areas: areas.join(", "),
    Verified: verified,
    Status: status,
    ApprovalStatus: approvalStatus,
    CustomCategory: newCategories.length ? newCategories.join(", ") : "",
    UpdatedAt: now,
  };

  if (existingRowNumber !== -1) {
    updateRowFromData_(providerSheet, existingRowNumber, providerData);
  } else {
    providerData.CreatedAt = now;
    providerSheet.appendRow(buildRowFromData_(providerHeaders, providerData));
  }

  upsertMappingRows_(
    "ProviderAreas",
    ["ProviderID", "Phone", "Area", "Status", "CreatedAt"],
    "ProviderID",
    providerId,
    areas.map(function (area) {
      return {
        ProviderID: providerId,
        Phone: phone,
        Area: area,
        Status: "Active",
        CreatedAt: now,
      };
    })
  );

  upsertMappingRows_(
    "ProviderServices",
    ["ProviderID", "Phone", "Category", "CategoryName", "CategoryID", "Status", "CreatedAt"],
    "ProviderID",
    providerId,
    submittedCategories.map(function (category) {
      var normalized = normalizeCategoryName_(category);
      var key = normalized.toLowerCase();
      var categoryMeta = categoriesLookup[key] || {
        categoryName: normalized,
        categoryId: "",
      };
      return {
        ProviderID: providerId,
        Phone: phone,
        Category: categoryMeta.categoryName || normalized,
        CategoryName: categoryMeta.categoryName || normalized,
        CategoryID: categoryMeta.categoryId || "",
        Status: "Active",
        CreatedAt: now,
      };
    })
  );

  upsertCategoryApplications_(providerId, name, phone, newCategories, now);

  try {
    sendProviderRegistrationConfirmation_(phone, providerId, !requiresApproval);
  } catch (waErr) {
    Logger.log("Provider registration WhatsApp send failed: " + waErr);
  }

  return createJsonResponse({
    ok: true,
    status: "success",
    providerId: providerId,
  });
}

function handleGetProviderProfile_(payload) {
  var phoneRaw = payload && payload.phone ? String(payload.phone).trim() : "";
  var phone = normalizeIndianMobile(phoneRaw);
  if (!phone) {
    return createJsonResponse({ ok: false, error: "NOT_FOUND" });
  }
  var rowNumber = getProviderRowByPhone_(phone);
  if (rowNumber === -1) {
    return createJsonResponse({ ok: false, error: "NOT_FOUND" });
  }
  var sheetBundle = getProvidersSheetAndHeaders_();
  var sheet = sheetBundle.sheet;
  var headers = sheetBundle.headers || [];
  var row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0] || [];
  var idxProviderId =
    headerIndex(headers, "ProviderID") !== -1
      ? headerIndex(headers, "ProviderID")
      : headerIndex(headers, "ID");
  var idxName = headerIndex(headers, "Name");
  var idxPhone = headerIndex(headers, "Phone");
  var idxVerified = headerIndex(headers, "Verified");
  var idxStatus = headerIndex(headers, "Status");

  return createJsonResponse({
    ok: true,
    provider: {
      ProviderID:
        idxProviderId !== -1 && row[idxProviderId] !== undefined
          ? String(row[idxProviderId]).trim()
          : "",
      Name: idxName !== -1 && row[idxName] !== undefined ? String(row[idxName]).trim() : "",
      Phone: idxPhone !== -1 && row[idxPhone] !== undefined ? String(row[idxPhone]).trim() : "",
      Verified:
        idxVerified !== -1 && row[idxVerified] !== undefined
          ? String(row[idxVerified]).trim()
          : "no",
      Status:
        idxStatus !== -1 && row[idxStatus] !== undefined ? String(row[idxStatus]).trim() : "",
    },
  });
}

function getAllCategoriesFromSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Categories");
  if (!sheet) {
    return [];
  }

  var values = sheet.getDataRange().getValues();
  if (!values || values.length < 2) {
    return [];
  }

  var headers = values[0] || [];
  var idxCategoryName =
    headerIndex(headers, "CategoryName") !== -1
      ? headerIndex(headers, "CategoryName")
      : headerIndex(headers, "Category");
  var idxStatus = headerIndex(headers, "Status");
  var idxActive = headerIndex(headers, "Active");

  var uniqueByLower = {};
  var categories = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i] || [];
    var name =
      idxCategoryName !== -1 && row[idxCategoryName] !== undefined
        ? normalizeCategoryName_(row[idxCategoryName])
        : String(row[1] || "").trim();
    if (!name) continue;
    var isActive = true;
    if (idxStatus !== -1 && row[idxStatus] !== undefined && String(row[idxStatus]).trim() !== "") {
      var status = String(row[idxStatus]).trim().toLowerCase();
      isActive = status === "active" || status === "approved" || status === "yes";
    } else if (idxActive !== -1 && row[idxActive] !== undefined && String(row[idxActive]).trim() !== "") {
      var active = String(row[idxActive]).trim().toLowerCase();
      isActive = active === "yes" || active === "true" || active === "1";
    }
    if (!isActive) continue;
    var key = name.toLowerCase();
    if (uniqueByLower[key]) continue;
    uniqueByLower[key] = true;
    categories.push(name);
  }

  categories.sort(function (a, b) {
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });

  return categories;
}

function getAreas_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("Areas");
  if (!sheet) {
    return { ok: true, areas: [] };
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return { ok: true, areas: [] };
  }
  var values = sheet.getRange(2, 1, lastRow - 1, Math.max(2, sheet.getLastColumn())).getValues();

  var seen = {};
  var areas = [];

  for (var i = 0; i < values.length; i++) {
    var row = values[i] || [];
    var rawArea = row[0] === undefined || row[0] === null ? "" : String(row[0]);
    var rawActive = row[1] === undefined || row[1] === null ? "" : String(row[1]);
    var normalized = rawArea.replace(/\s+/g, " ").trim();
    var active = rawActive.replace(/\s+/g, " ").trim().toLowerCase();
    if (active !== "yes") continue;
    if (!normalized) continue;
    var key = normalized.toLowerCase();
    if (seen[key]) continue;
    seen[key] = true;
    areas.push(normalized);
  }

  areas.sort(function (a, b) {
    return a.toLowerCase().localeCompare(b.toLowerCase());
  });

  return { ok: true, areas: areas };
}

function handleAppendSheetRow_(payload) {
  var tabName = payload && payload.tabName ? String(payload.tabName).trim() : "";
  var data = payload && payload.data ? payload.data : null;
  if (!tabName || !data) {
    return createErrorResponse("Missing tabName or data");
  }

  var sheet = getSheetForTab_(tabName);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];
  if (!headers.length) {
    return createErrorResponse("Sheet has no headers");
  }

  sheet.appendRow(buildRowFromData_(headers, data));
  return createJsonResponse({ success: true });
}

function handleUpdateSheetRow_(payload) {
  var tabName = payload && payload.tabName ? String(payload.tabName).trim() : "";
  var rowNumber = payload && payload.rowNumber ? Number(payload.rowNumber) : 0;
  var data = payload && payload.data ? payload.data : null;
  if (!tabName || !rowNumber || !data) {
    return createErrorResponse("Missing tabName, rowNumber, or data");
  }

  var sheet = getSheetForTab_(tabName);
  updateRowFromData_(sheet, rowNumber, data);
  return createJsonResponse({ success: true });
}
