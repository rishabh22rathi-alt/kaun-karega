/*************************************************
 * SHARED UTILITIES
 *************************************************/
function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj || {})).setMimeType(
    ContentService.MimeType.JSON
  );
}

function normalizePhone10_(phoneRaw) {
  if (!phoneRaw) return "";
  let digits = String(phoneRaw).replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  if (digits.length > 10) digits = digits.slice(-10);
  if (digits.length !== 10) return "";
  if (!/^[6-9]\d{9}$/.test(digits)) return "";
  return digits;
}

function generateOtp4_() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function nextProviderId_(providersSheet) {
  const data = providersSheet.getDataRange().getValues();
  let maxNum = 0;

  for (let i = 1; i < data.length; i++) {
    const pid = String(data[i][0] || "").trim();
    const m = pid.match(/^PR-(\d+)$/i);
    if (!m) continue;
    const num = Number(m[1]) || 0;
    if (num > maxNum) maxNum = num;
  }

  return "PR-" + ("0000" + (maxNum + 1)).slice(-4);
}

function deleteRowsByProvider_(sheet, providerId) {
  if (!sheet || !providerId) return;

  const data = sheet.getDataRange().getValues();
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][0] || "").trim() === String(providerId).trim()) {
      sheet.deleteRow(i + 1);
    }
  }
}

function normalizeIndianMobile_(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  const last10 = digits.length > 10 ? digits.slice(-10) : digits;
  return last10.length === 10 ? last10 : "";
}

function headerMap_(sheet) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const map = {};
  headers.forEach((h, idx) => {
    const key = String(h || "").trim().toLowerCase();
    if (key) map[key] = idx + 1;
  });
  return map;
}

function createJsonResponse(payload) {
  var output = ContentService.createTextOutput(JSON.stringify(payload || {}));
  output.setMimeType(ContentService.MimeType.JSON);
  return output;
}

function createUnauthorizedResponse() {
  // ContentService does not support setting HTTP status, so we include code in payload.
  return createJsonResponse({ error: "Unauthorized", code: 401 });
}

function createErrorResponse(message) {
  return createJsonResponse({
    success: false,
    error: message || "Unexpected error",
  });
}

function parseJsonBody(e) {
  try {
    var raw = (e && e.postData && e.postData.contents) || "{}";
    return JSON.parse(raw);
  } catch (err) {
    throw new Error("Invalid JSON body");
  }
}

function getSheetByName(sheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error("Sheet not found: " + sheetName);
  }
  return sheet;
}

function getOrCreateSheet(sheetName, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    if (headers && headers.length) {
      sheet.appendRow(headers);
    }
  }
  return sheet;
}

function ensureSheetHeaders_(sheet, requiredHeaders) {
  var lastColumn = sheet.getLastColumn();
  var headers = lastColumn
    ? sheet.getRange(1, 1, 1, lastColumn).getValues()[0]
    : [];
  var missing = (requiredHeaders || []).filter(function (header) {
    return headers.indexOf(header) === -1;
  });
  if (missing.length) {
    sheet
      .getRange(1, headers.length + 1, 1, missing.length)
      .setValues([missing]);
    headers = headers.concat(missing);
  }
  return headers;
}

function ensureUsersSheetExists_() {
  // Ensure Users sheet exists before upsert.
  return getOrCreateSheet("Users", ["phone", "first_login_at", "last_login_at"]);
}

function getSheetForTab_(tabName) {
  if (tabName === "Users") {
    return ensureUsersSheetExists_();
  }
  return getSheetByName(tabName);
}

function normalizeHeaderKey_(header) {
  return String(header || "").trim().toLowerCase();
}

function buildDataMap_(data) {
  var map = {};
  Object.keys(data || {}).forEach(function (key) {
    map[String(key).toLowerCase()] = data[key];
  });
  return map;
}

function buildRowFromData_(headers, data) {
  var map = buildDataMap_(data);
  return headers.map(function (header) {
    var key = normalizeHeaderKey_(header);
    return key in map ? map[key] : "";
  });
}

function updateRowFromData_(sheet, rowNumber, data) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn <= 0) return;
  var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0] || [];
  var map = buildDataMap_(data);
  headers.forEach(function (header, idx) {
    var key = normalizeHeaderKey_(header);
    if (key in map) {
      sheet.getRange(rowNumber, idx + 1).setValue(map[key]);
    }
  });
}

function headerIndex(headers, name) {
  return headers.indexOf(name);
}

function mapRowsToObjects(values) {
  if (!values || values.length < 2) return [];
  var headers = values[0];
  return values.slice(1).map(function (row) {
    var obj = {};
    headers.forEach(function (header, idx) {
      obj[header] = row[idx];
    });
    return obj;
  });
}

function toArray(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return String(value)
    .split(",")
    .map(function (item) {
      return item.trim();
    })
    .filter(function (item) {
      return item.length > 0;
    });
}

function findRowIndexByValue(sheet, headerName, value) {
  var data = sheet.getDataRange().getValues();
  if (!data.length) return -1;
  var headers = data[0];
  var colIndex = headerIndex(headers, headerName);
  if (colIndex === -1) return -1;
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][colIndex]) === String(value)) {
      return i + 1; // 1-based row index including header
    }
  }
  return -1;
}

function isAuthorized(e, method) {
  var keyFromParams = (e && e.parameter && e.parameter["x-admin-key"]) || "";
  var keyFromHeaders =
    (e && e.headers && e.headers["x-admin-key"]) ||
    (e && e.parameter && e.parameter["x-admin-key"]) ||
    "";
  var bodyKey = "";

  if (method === "POST") {
    try {
      var body = parseJsonBody(e);
      bodyKey = body.adminKey || body["x-admin-key"] || "";
    } catch (err) {
      bodyKey = "";
    }
  }

  var keyToValidate =
    method === "GET" ? keyFromParams || keyFromHeaders : bodyKey || keyFromHeaders;
  return keyToValidate && keyToValidate === ADMIN_API_KEY;
}
