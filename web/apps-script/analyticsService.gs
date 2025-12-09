/**
 * Aggregates lead stats from Lead_Stats sheet.
 */
function getLeadStatsData() {
  var sheet = getOrCreateSheet("Lead_Stats", ["Date", "Area", "Category", "LeadCount"]);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) {
    return {
      daily: [],
      byArea: [],
      byCategory: [],
    };
  }

  var headers = data[0];
  var idxDate = headerIndex(headers, "Date");
  var idxArea = headerIndex(headers, "Area");
  var idxCategory = headerIndex(headers, "Category");
  var idxCount = headerIndex(headers, "LeadCount");

  var daily = [];
  var byArea = {};
  var byCategory = {};

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var date = row[idxDate];
    var area = row[idxArea];
    var category = row[idxCategory];
    var count = Number(row[idxCount] || 0);

    daily.push({
      date: date,
      area: area,
      category: category,
      leadCount: count,
    });

    var areaKey = String(area || "");
    byArea[areaKey] = (byArea[areaKey] || 0) + count;

    var catKey = String(category || "");
    byCategory[catKey] = (byCategory[catKey] || 0) + count;
  }

  return {
    daily: daily,
    byArea: Object.keys(byArea).map(function (area) {
      return { area: area, totalLeads: byArea[area] };
    }),
    byCategory: Object.keys(byCategory).map(function (category) {
      return { category: category, totalLeads: byCategory[category] };
    }),
  };
}

/**
 * Returns area-category matrix from Lead_Stats.
 */
function getAreaCategoryMatrixData() {
  var sheet = getOrCreateSheet("Lead_Stats", ["Date", "Area", "Category", "LeadCount"]);
  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  var headers = data[0];
  var idxArea = headerIndex(headers, "Area");
  var idxCategory = headerIndex(headers, "Category");
  var idxCount = headerIndex(headers, "LeadCount");

  var matrix = {};
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var area = row[idxArea];
    var category = row[idxCategory];
    var count = Number(row[idxCount] || 0);
    var key = area + "__" + category;
    matrix[key] = (matrix[key] || 0) + count;
  }

  return Object.keys(matrix).map(function (key) {
    var parts = key.split("__");
    return { area: parts[0], category: parts[1], leads: matrix[key] };
  });
}

/**
 * Builds provider performance stats using distribution and response logs.
 */
function getProviderStatsData() {
  var providersSheet = getSheetByName("Master_Providers");
  var provData = providersSheet.getDataRange().getValues();
  var provHeaders = provData[0];
  var pIdIdx = headerIndex(provHeaders, "ProviderID") !== -1 ? headerIndex(provHeaders, "ProviderID") : headerIndex(provHeaders, "ID");
  var pNameIdx = headerIndex(provHeaders, "Name");
  var pPhoneIdx = headerIndex(provHeaders, "Phone");

  var providers = {};
  for (var i = 1; i < provData.length; i++) {
    var row = provData[i];
    var pid = row[pIdIdx];
    providers[String(pid)] = {
      providerId: pid,
      name: row[pNameIdx] || "",
      phone: row[pPhoneIdx] || "",
      tasksSent: 0,
      tasksAccepted: 0,
      responseRate: 0,
    };
  }

  var distSheet = getOrCreateSheet("Distribution_Log", [
    "TaskID",
    "ProviderID",
    "Area",
    "Category",
    "SentAt",
    "Status",
  ]);
  var distData = distSheet.getDataRange().getValues();
  var distHeaders = distData[0];
  var dProvIdx = headerIndex(distHeaders, "ProviderID");
  for (var d = 1; d < distData.length; d++) {
    var dPid = distData[d][dProvIdx];
    if (providers[String(dPid)]) {
      providers[String(dPid)].tasksSent += 1;
    }
  }

  var respSheet = getOrCreateSheet("Task_Response_Log", [
    "TaskID",
    "ProviderID",
    "Area",
    "Category",
    "ResponseAt",
    "ResponseStatus",
  ]);
  var respData = respSheet.getDataRange().getValues();
  var respHeaders = respData[0];
  var rProvIdx = headerIndex(respHeaders, "ProviderID");
  for (var r = 1; r < respData.length; r++) {
    var rPid = respData[r][rProvIdx];
    if (providers[String(rPid)]) {
      providers[String(rPid)].tasksAccepted += 1;
    }
  }

  Object.keys(providers).forEach(function (pid) {
    var stats = providers[pid];
    stats.responseRate = stats.tasksSent
      ? Math.round((stats.tasksAccepted / stats.tasksSent) * 100)
      : 0;
  });

  return Object.keys(providers).map(function (pid) {
    return providers[pid];
  });
}
