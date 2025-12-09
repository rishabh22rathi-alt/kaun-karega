/**
 * Utility helpers for JSON responses, CORS-friendly text outputs, and sheet helpers.
 */
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

/**
 * Validates incoming requests against ADMIN_API_KEY.
 * For GET, reads x-admin-key from query params.
 * For POST, reads adminKey from JSON body (and also allows x-admin-key in params).
 */
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

  var keyToValidate = method === "GET" ? keyFromParams || keyFromHeaders : bodyKey || keyFromHeaders;
  return keyToValidate && keyToValidate === ADMIN_API_KEY;
}
