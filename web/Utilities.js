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

function normalizeComparableKey_(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function findHeaderIndexByAliases_(headers, aliases) {
  const normalizedHeaders = (headers || []).map((header) =>
    normalizeComparableKey_(header)
  );
  const normalizedAliases = (aliases || []).map((alias) =>
    normalizeComparableKey_(alias)
  );

  for (let i = 0; i < normalizedAliases.length; i++) {
    const idx = normalizedHeaders.indexOf(normalizedAliases[i]);
    if (idx !== -1) return idx;
  }

  return -1;
}

function normalizeCategoryName_(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getNormalizedCategoryKey_(value) {
  return normalizeCategoryName_(value).toLowerCase();
}

function getProviderMatchingCategoryKey_(value) {
  var normalized = getNormalizedCategoryKey_(value);
  if (!normalized) return "";

  var collapsed = normalized.replace(/[^a-z0-9]/g, "");
  if (
    collapsed === "preschool" ||
    collapsed === "preschools" ||
    collapsed === "playschool" ||
    collapsed === "playschools"
  ) {
    return "preschoolplayschool";
  }

  return normalized;
}

function uniqueNormalizedValues_(values) {
  const out = [];
  const seen = new Set();

  (values || []).forEach((value) => {
    const normalized = normalizeCategoryName_(value);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  });

  return out;
}

function isTruthySheetValue_(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "yes" || normalized === "true" || normalized === "1";
}

function normalizeVerifiedProviderValue_(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "yes" ||
    normalized === "true" ||
    normalized === "1" ||
    normalized === "verified"
  ) {
    return "yes";
  }

  if (
    normalized === "no" ||
    normalized === "false" ||
    normalized === "0" ||
    normalized === "not verified" ||
    normalized === "unverified"
  ) {
    return "no";
  }

  return normalized ? "no" : "";
}

function isVerifiedProviderValue_(value) {
  return normalizeVerifiedProviderValue_(value) === "yes";
}

function normalizeOtpVerifiedValue_(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "yes" ||
    normalized === "true" ||
    normalized === "1"
  ) {
    return "yes";
  }

  if (
    normalized === "no" ||
    normalized === "false" ||
    normalized === "0" ||
    normalized === "not verified" ||
    normalized === "unverified" ||
    normalized === ""
  ) {
    return "no";
  }

  return "no";
}

function isOtpVerifiedProviderValue_(value) {
  return normalizeOtpVerifiedValue_(value) === "yes";
}

// Returns true if the provider's OTP verification is still within the 30-day window.
// Transition rule: if otpVerifiedAt is blank, treat as valid (legacy provider not yet re-verified).
// Once OtpVerifiedAt is written by a new OTP login, the 30-day expiry is enforced from that point.
function isOtpStillValidGas_(otpVerified, otpVerifiedAt) {
  if (normalizeOtpVerifiedValue_(otpVerified) !== "yes") return false;
  var at = String(otpVerifiedAt || "").trim();
  if (!at) return true; // transition: legacy provider, no OtpVerifiedAt written yet
  var parsed = new Date(at);
  if (isNaN(parsed.getTime())) return false;
  var thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
  return (new Date() - parsed) <= thirtyDaysMs;
}

// Full verified badge rule (GAS):
//   registered_with_us = Verified === "yes"
//   otp_still_valid    = OtpVerified === "yes" AND (OtpVerifiedAt blank OR within 30 days)
//   not_pending        = PendingApproval !== "yes"
function isProviderVerifiedBadgeGas_(provider) {
  if (!provider || typeof provider !== "object") return false;
  var verified = provider.Verified || provider.verified || "";
  if (normalizeVerifiedProviderValue_(verified) !== "yes") return false;
  var otpVerified = provider.OtpVerified || provider.otpVerified || "";
  var otpVerifiedAt = provider.OtpVerifiedAt || provider.otpVerifiedAt || "";
  if (!isOtpStillValidGas_(otpVerified, otpVerifiedAt)) return false;
  var pending = String(provider.PendingApproval || provider.pendingApproval || "").trim().toLowerCase();
  if (pending === "yes") return false;
  return true;
}

function isActiveCategoryRow_(row, idxStatus, idxActive) {
  if (
    idxStatus !== -1 &&
    row[idxStatus] !== undefined &&
    String(row[idxStatus]).trim() !== ""
  ) {
    const status = String(row[idxStatus]).trim().toLowerCase();
    return status === "active" || status === "approved" || status === "yes";
  }

  if (
    idxActive !== -1 &&
    row[idxActive] !== undefined &&
    String(row[idxActive]).trim() !== ""
  ) {
    return isTruthySheetValue_(row[idxActive]);
  }

  return true;
}

function getProviderHeaderMap_(headers) {
  return {
    providerId: findHeaderIndexByAliases_(headers, ["ProviderID", "ID"]),
    providerName: findHeaderIndexByAliases_(headers, [
      "ProviderName",
      "Name",
      "Provider",
    ]),
    phone: findHeaderIndexByAliases_(headers, ["Phone", "ProviderPhone", "UserPhone"]),
    category: findHeaderIndexByAliases_(headers, ["Category", "Categories", "Service", "Services"]),
    areas: findHeaderIndexByAliases_(headers, ["Areas", "Area"]),
    verified: findHeaderIndexByAliases_(headers, ["Verified", "IsVerified"]),
    otpVerified: findHeaderIndexByAliases_(headers, ["OtpVerified", "OTPVerified", "PhoneVerified"]),
    otpVerifiedAt: findHeaderIndexByAliases_(headers, ["OtpVerifiedAt", "OTPVerifiedAt"]),
    lastLoginAt: findHeaderIndexByAliases_(headers, ["LastLoginAt"]),
    status: findHeaderIndexByAliases_(headers, ["Status"]),
    approvalStatus: findHeaderIndexByAliases_(headers, ["ApprovalStatus", "Approval Status"]),
    pendingApproval: findHeaderIndexByAliases_(headers, [
      "PendingApproval",
      "Pending Approval",
      "PendingCategories",
    ]),
    customCategory: findHeaderIndexByAliases_(headers, [
      "CustomCategory",
      "Custom Category",
      "PendingCategories",
    ]),
    createdAt: findHeaderIndexByAliases_(headers, ["CreatedAt", "Timestamp"]),
    updatedAt: findHeaderIndexByAliases_(headers, ["UpdatedAt"]),
  };
}

function getProviderSheetFieldIndex_(headers, fieldName) {
  const map = getProviderHeaderMap_(headers);

  if (fieldName === "ProviderID") return map.providerId;
  if (fieldName === "Name") return map.providerName;
  if (fieldName === "Phone") return map.phone;
  if (fieldName === "Category") return map.category;
  if (fieldName === "Areas") return map.areas;
  if (fieldName === "Verified") return map.verified;
  if (fieldName === "OtpVerified") return map.otpVerified;
  if (fieldName === "OtpVerifiedAt") return map.otpVerifiedAt;
  if (fieldName === "LastLoginAt") return map.lastLoginAt;
  if (fieldName === "Status") return map.status;
  if (fieldName === "ApprovalStatus") return map.approvalStatus;
  if (fieldName === "PendingApproval") return map.pendingApproval;
  if (fieldName === "CustomCategory") return map.customCategory;
  if (fieldName === "CreatedAt") return map.createdAt;
  if (fieldName === "UpdatedAt") return map.updatedAt;

  return findHeaderIndexByAliases_(headers, [fieldName]);
}

function buildProviderSheetRow_(headers, data, existingRow) {
  const row = Array.isArray(existingRow) ? existingRow.slice() : [];
  while (row.length < headers.length) row.push("");

  Object.keys(data || {}).forEach((fieldName) => {
    const idx = getProviderSheetFieldIndex_(headers, fieldName);
    if (idx === -1) return;
    row[idx] = data[fieldName];
  });

  return row;
}

function upsertProviderSheetRow_(sheet, headers, rowNumber, data) {
  const existingRow =
    rowNumber > 1 ? sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0] || [] : [];
  const row = buildProviderSheetRow_(headers, data, existingRow);

  if (rowNumber > 1) {
    sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row]);
    return;
  }

  sheet.appendRow(row);
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
