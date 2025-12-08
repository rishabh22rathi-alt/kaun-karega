/**
 * Provider data access functions for Master_Providers sheet.
 * Relies on ADMIN_API_KEY defined in config.gs for upstream security checks.
 */
var PROVIDER_SHEET_NAME = "Master_Providers";

function getProviderSheet() {
  return getSheetByName(PROVIDER_SHEET_NAME);
}

function buildProviderObject(rowObj) {
  return {
    id: rowObj.ProviderID || rowObj.ID || rowObj.Id,
    name: rowObj.Name || "",
    phone: rowObj.Phone || "",
    categories: toArray(rowObj.Category || rowObj.Categories),
    areas: toArray(rowObj.Area || rowObj.Areas),
    status: rowObj.Status || "",
    totalTasks: Number(rowObj.TotalTasks || 0),
    totalResponses: Number(rowObj.TotalResponses || 0),
  };
}

function getAllProviders() {
  var sheet = getProviderSheet();
  var data = sheet.getDataRange().getValues();
  var rows = mapRowsToObjects(data);
  return rows
    .filter(function (row) {
      return row.ProviderID || row.ID || row.Id;
    })
    .map(buildProviderObject);
}

function getProviderById(providerId) {
  var sheet = getProviderSheet();
  var data = sheet.getDataRange().getValues();
  if (!data.length) return null;
  var headers = data[0];
  var idCol =
    headerIndex(headers, "ProviderID") !== -1
      ? headerIndex(headers, "ProviderID")
      : headerIndex(headers, "ID");
  if (idCol === -1) return null;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(providerId)) {
      var obj = {};
      headers.forEach(function (h, idx) {
        obj[h] = data[i][idx];
      });
      return buildProviderObject(obj);
    }
  }
  return null;
}

function updateProviderDetails(payload) {
  if (!payload || !payload.id) {
    throw new Error("Provider id is required");
  }
  var sheet = getProviderSheet();
  var data = sheet.getDataRange().getValues();
  if (!data.length) {
    throw new Error("Sheet has no data");
  }
  var headers = data[0];
  var nameCol = headerIndex(headers, "Name") + 1;
  var phoneCol = headerIndex(headers, "Phone") + 1;
  var categoryCol = headerIndex(headers, "Category") + 1;
  var areaCol = headerIndex(headers, "Area") + 1;

  var idCol =
    headerIndex(headers, "ProviderID") !== -1
      ? headerIndex(headers, "ProviderID") + 1
      : headerIndex(headers, "ID") + 1;

  if (idCol === 0) throw new Error("Provider ID column not found");

  var targetRow = findRowIndexByValue(sheet, "ProviderID", payload.id);
  if (targetRow === -1 && headerIndex(headers, "ID") !== -1) {
    targetRow = findRowIndexByValue(sheet, "ID", payload.id);
  }
  if (targetRow === -1) {
    throw new Error("Provider not found");
  }

  if (nameCol > 0 && payload.name) {
    sheet.getRange(targetRow, nameCol).setValue(payload.name);
  }
  if (phoneCol > 0 && payload.phone) {
    sheet.getRange(targetRow, phoneCol).setValue(payload.phone);
  }
  if (categoryCol > 0 && payload.categories) {
    sheet
      .getRange(targetRow, categoryCol)
      .setValue(toArray(payload.categories).join(", "));
  }
  if (areaCol > 0 && payload.areas) {
    sheet.getRange(targetRow, areaCol).setValue(toArray(payload.areas).join(", "));
  }
  return { success: true };
}

function setProviderStatus(providerId, status) {
  var sheet = getProviderSheet();
  var data = sheet.getDataRange().getValues();
  if (!data.length) throw new Error("Sheet has no data");
  var headers = data[0];
  var statusCol = headerIndex(headers, "Status") + 1;
  var idCol =
    headerIndex(headers, "ProviderID") !== -1
      ? headerIndex(headers, "ProviderID") + 1
      : headerIndex(headers, "ID") + 1;
  if (statusCol === 0 || idCol === 0) throw new Error("Required columns missing");

  var targetRow = findRowIndexByValue(sheet, "ProviderID", providerId);
  if (targetRow === -1 && headerIndex(headers, "ID") !== -1) {
    targetRow = findRowIndexByValue(sheet, "ID", providerId);
  }
  if (targetRow === -1) throw new Error("Provider not found");

  sheet.getRange(targetRow, statusCol).setValue(status);
  return { status: status };
}
