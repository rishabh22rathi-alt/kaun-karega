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
    return handleRequest(e, "GET");
  } catch (err) {
    return createErrorResponse(err.message);
  }
}

function doPost(e) {
  try {
    var action = e && e.parameter && e.parameter.action;
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
      incrementLeadStats(taskPayload);
      var notified = notifyProvidersForTask(taskPayload);
      return createJsonResponse({ success: true, notifiedProviders: notified });
    } catch (errTask) {
      return createErrorResponse(errTask.message);
    }
  }

  if (method === "GET" && path === "tasks/listNoResponse") {
    try {
      var tasks = listTasksWithoutResponse();
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

  var tasksSheet = getOrCreateSheet("Tasks", [
    "TaskID",
    "UserPhone",
    "Category",
    "Area",
    "Details",
    "CreatedAt",
  ]);

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

  tasksSheet.appendRow([taskId, phone, category, area, "", now]);

  var providersSheet = getSheetByName("Master_Providers");
  var pData = providersSheet.getDataRange().getValues();
  var matched = 0;

  if (pData.length > 1) {
    var pHeaders = pData[0];
    var idxProvId = headerIndex(pHeaders, "ProviderID");
    var idxCategories = headerIndex(pHeaders, "Categories");
    var idxAreas = headerIndex(pHeaders, "Areas");

    var targetCategory = category.toLowerCase();
    var targetArea = area.toLowerCase();

    var distSheet = getOrCreateSheet("Distribution_Log", [
      "TaskID",
      "ProviderID",
      "Area",
      "Category",
      "SentAt",
      "ResentCount",
    ]);

    pData.slice(1).forEach(function (row) {
      var providerId = idxProvId !== -1 ? row[idxProvId] : "";
      if (!providerId && !row[idxCategories] && !row[idxAreas]) return;

      var providerCategories = toArray(row[idxCategories]).map(function (c) {
        return c.toLowerCase();
      });
      var providerAreas = toArray(row[idxAreas]).map(function (a) {
        return a.toLowerCase();
      });

      var categoryMatch = providerCategories.indexOf(targetCategory) !== -1;
      var areaMatch = providerAreas.indexOf(targetArea) !== -1;
      if (!categoryMatch || !areaMatch) return;

      matched++;
      distSheet.appendRow([taskId, providerId, area, category, now, 0]);
    });
  }

  return {
    success: true,
    taskId: taskId,
    matchedProviders: matched,
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

  var tasksSheet = getOrCreateSheet("Tasks", [
    "TaskID",
    "UserPhone",
    "Category",
    "Area",
    "Details",
    "CreatedAt",
  ]);

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

  tasksSheet.appendRow([taskId, phone, category, area, "", now]);

  var providersSheet = getSheetByName("Master_Providers");
  var providersData = providersSheet.getDataRange().getValues();
  var matched = 0;
  if (providersData.length > 1) {
    var pHeaders = providersData[0];
    var idxProvId = headerIndex(pHeaders, "ProviderID");
    var idxCategories = headerIndex(pHeaders, "Categories");
    var idxAreas = headerIndex(pHeaders, "Areas");

    if (idxCategories !== -1 && idxAreas !== -1) {
      var targetCategory = category.toLowerCase();
      var targetArea = area.toLowerCase();

      var distSheet = getOrCreateSheet("Distribution_Log", [
        "TaskID",
        "ProviderID",
        "Area",
        "Category",
        "SentAt",
        "ResentCount",
      ]);

      providersData.slice(1).forEach(function (row) {
        var providerId = idxProvId !== -1 ? row[idxProvId] : "";
        if (!providerId && !row[idxCategories] && !row[idxAreas]) return;

        var providerCategories = toArray(row[idxCategories]).map(function (c) {
          return c.toLowerCase();
        });
        var providerAreas = toArray(row[idxAreas]).map(function (a) {
          return a.toLowerCase();
        });

        var categoryMatch = providerCategories.indexOf(targetCategory) !== -1;
        var areaMatch = providerAreas.indexOf(targetArea) !== -1;
        if (!categoryMatch || !areaMatch) return;

        matched++;
        distSheet.appendRow([taskId, providerId, area, category, now, 0]);
      });
    }
  }

  return createJsonResponse({
    success: true,
    taskId: taskId,
    matchedProviders: matched,
  });
}
