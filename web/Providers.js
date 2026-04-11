/*************************************************
 * PROVIDER TASK MATCH PERSISTENCE
 *************************************************/
function getProviderTaskMatchesSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh = ss.getSheetByName(SHEET_PROVIDER_TASK_MATCHES);

  if (!sh) {
    sh = ss.insertSheet(SHEET_PROVIDER_TASK_MATCHES);
    sh.appendRow([
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
      "AcceptedAt"
    ]);
  }

  return sh;
}

function nextMatchId_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return "MATCH-0001";

  let maxSeq = 0;
  for (let i = 1; i < values.length; i++) {
    const matchId = String(values[i][0] || "").trim();
    const m = matchId.match(/^MATCH-(\d+)$/i);
    if (!m) continue;
    const seq = Number(m[1]) || 0;
    if (seq > maxSeq) maxSeq = seq;
  }

  return "MATCH-" + ("000" + (maxSeq + 1)).slice(-4);
}

function incrementMatchId_(matchId) {
  const m = String(matchId || "").match(/^MATCH-(\d+)$/i);
  const seq = m ? Number(m[1]) || 0 : 0;
  return "MATCH-" + ("000" + (seq + 1)).slice(-4);
}

function removeMatchesForTask_(sheet, taskId) {
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][1] || "").trim() === String(taskId || "").trim()) {
      sheet.deleteRow(i + 1);
    }
  }
}

function providerMatchPriority_(provider) {
  if (!provider || typeof provider !== "object") return 2;

  const explicit = Number(provider.matchPriority || provider.MatchPriority || 0);
  if (explicit === 1 || explicit === 2) return explicit;

  return isProviderVerifiedBadgeGas_(provider) ? 1 : 2;
}

function saveProviderMatches_(data) {
  const taskId = String(data.taskId || "").trim();
  const category = String(data.category || "").trim();
  const area = String(data.area || "").trim();
  const details = String(data.details || "").trim();
  const providers = Array.isArray(data.providers) ? data.providers : [];

  if (!taskId) {
    return { ok: false, status: "error", error: "Missing taskId" };
  }

  const sh = getProviderTaskMatchesSheet_();

  removeMatchesForTask_(sh, taskId);

  if (providers.length === 0) {
    if (typeof syncTaskSummaryByTaskId_ === "function") {
      syncTaskSummaryByTaskId_(taskId);
    }
    if (typeof syncProviderInboxForTask_ === "function") {
      syncProviderInboxForTask_(taskId);
    }
    return { ok: true, status: "success", taskId: taskId, saved: 0 };
  }

  const normalizedProviders = [];
  for (let i = 0; i < providers.length; i++) {
    const p = providers[i] || {};
    const providerId = String(p.providerId || p.ProviderID || p.id || "").trim();
    const providerPhone = String(p.providerPhone || p.ProviderPhone || p.phone || "").trim();
    const providerName = String(p.providerName || p.ProviderName || p.name || "").trim();

    if (!providerId && !providerPhone) continue;

    normalizedProviders.push({
      providerId: providerId,
      providerPhone: providerPhone,
      providerName: providerName,
      matchPriority: providerMatchPriority_(p)
    });
  }

  normalizedProviders.sort((a, b) => {
    if (a.matchPriority !== b.matchPriority) {
      return a.matchPriority - b.matchPriority;
    }
    if (a.providerName !== b.providerName) {
      return String(a.providerName).localeCompare(String(b.providerName));
    }
    return String(a.providerId).localeCompare(String(b.providerId));
  });

  if (normalizedProviders.length === 0) {
    if (typeof syncTaskSummaryByTaskId_ === "function") {
      syncTaskSummaryByTaskId_(taskId);
    }
    if (typeof syncProviderInboxForTask_ === "function") {
      syncProviderInboxForTask_(taskId);
    }
    return { ok: true, status: "success", taskId: taskId, saved: 0 };
  }

  let nextId = nextMatchId_(sh);
  const createdAt = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");

  const rows = normalizedProviders.map((p) => {
    const row = [
      nextId,
      taskId,
      p.providerId,
      p.providerPhone,
      p.providerName,
      category,
      area,
      details || "-",
      p.matchPriority,
      "new",
      createdAt,
      ""
    ];
    nextId = incrementMatchId_(nextId);
    return row;
  });

  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  if (typeof syncTaskSummaryByTaskId_ === "function") {
    syncTaskSummaryByTaskId_(taskId);
  }
  if (typeof syncProviderInboxForTask_ === "function") {
    syncProviderInboxForTask_(taskId);
  }

  return {
    ok: true,
    status: "success",
    taskId: taskId,
    saved: rows.length
  };
}

/*************************************************
 * PROVIDER REGISTER (Normalized mapping)
 *************************************************/
function getApprovedCategoriesLookup_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEET_CATEGORIES);
  const byKey = {};

  if (!sheet || sheet.getLastRow() < 2) return byKey;

  const values = sheet.getDataRange().getValues();
  const headers = values[0] || [];
  const idxName = findHeaderIndexByAliases_(headers, [
    "CategoryName",
    "category_name",
    "Category",
    "Name",
    "Service",
  ]);
  const idxStatus = findHeaderIndexByAliases_(headers, ["Status"]);
  const idxActive = findHeaderIndexByAliases_(headers, ["Active"]);

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const categoryName =
      idxName !== -1 && row[idxName] !== undefined
        ? normalizeCategoryName_(row[idxName])
        : "";
    if (!categoryName) continue;
    if (!isActiveCategoryRow_(row, idxStatus, idxActive)) continue;

    const key = categoryName.toLowerCase();
    if (!byKey[key]) {
      byKey[key] = { categoryName: categoryName };
    }
  }

  return byKey;
}

function upsertCategoryApplications_(providerId, providerName, phone, categories, now) {
  const requestedCategories = uniqueNormalizedValues_(categories);
  const sheet = getOrCreateSheet("CategoryApplications", [
    "RequestID",
    "ProviderID",
    "ProviderName",
    "Phone",
    "RequestedCategory",
    "Status",
    "CreatedAt",
    "UpdatedAt",
    "AdminActionBy",
    "AdminActionAt",
    "AdminActionReason",
  ]);
  const headers = ensureSheetHeaders_(sheet, [
    "RequestID",
    "ProviderID",
    "ProviderName",
    "Phone",
    "RequestedCategory",
    "Status",
    "CreatedAt",
    "UpdatedAt",
    "AdminActionBy",
    "AdminActionAt",
    "AdminActionReason",
  ]);
  const values = sheet.getDataRange().getValues();

  const idxRequestId = findHeaderIndexByAliases_(headers, ["RequestID"]);
  const idxProviderId = findHeaderIndexByAliases_(headers, ["ProviderID"]);
  const idxPhone = findHeaderIndexByAliases_(headers, ["Phone", "ProviderPhone"]);
  const idxCategory = findHeaderIndexByAliases_(headers, ["RequestedCategory", "Category"]);
  const idxStatus = findHeaderIndexByAliases_(headers, ["Status"]);
  const idxUpdatedAt = findHeaderIndexByAliases_(headers, ["UpdatedAt"]);

  const pendingKeys = new Set();
  const requestedCategoryKeys = new Set(
    requestedCategories.map((category) => String(category || "").trim().toLowerCase())
  );
  let maxSeq = 0;
  const rowsToCancel = [];

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const requestId =
      idxRequestId !== -1 && row[idxRequestId] !== undefined
        ? String(row[idxRequestId]).trim()
        : "";
    const match = requestId.match(/^PCR-(\d+)$/i);
    if (match) {
      const seq = Number(match[1]) || 0;
      if (seq > maxSeq) maxSeq = seq;
    }

    const existingProviderId =
      idxProviderId !== -1 && row[idxProviderId] !== undefined
        ? String(row[idxProviderId]).trim()
        : "";
    const existingPhone =
      idxPhone !== -1 && row[idxPhone] !== undefined ? normalizePhone10_(row[idxPhone]) : "";
    const existingCategory =
      idxCategory !== -1 && row[idxCategory] !== undefined
        ? getNormalizedCategoryKey_(row[idxCategory])
        : "";
    const existingStatus =
      idxStatus !== -1 && row[idxStatus] !== undefined
        ? String(row[idxStatus]).trim().toLowerCase()
        : "";

    const sameProvider =
      (providerId && existingProviderId === String(providerId).trim()) ||
      (phone && existingPhone === normalizePhone10_(phone));

    if (!sameProvider || !existingCategory || existingStatus !== "pending") {
      continue;
    }

    if (requestedCategoryKeys.has(existingCategory)) {
      pendingKeys.add(existingProviderId + "|" + existingCategory);
    } else {
      rowsToCancel.push(i + 1);
    }
  }

  rowsToCancel.forEach((rowNumber) => {
    const updates = { Status: "cancelled" };
    if (idxUpdatedAt !== -1) {
      updates.UpdatedAt = now || new Date();
    }
    updateRowFromData_(sheet, rowNumber, updates);
  });

  const rowsToAppend = [];
  requestedCategories.forEach((category) => {
    const dedupeKey = String(providerId).trim() + "|" + category.toLowerCase();
    if (pendingKeys.has(dedupeKey)) return;

    maxSeq += 1;
    rowsToAppend.push(
      buildRowFromData_(headers, {
        RequestID: "PCR-" + ("0000" + maxSeq).slice(-4),
        ProviderID: providerId,
        ProviderName: providerName,
        Phone: phone,
        RequestedCategory: category,
        Status: "pending",
        CreatedAt: now || new Date(),
      })
    );
  });

  if (!rowsToAppend.length) return;

  sheet
    .getRange(sheet.getLastRow() + 1, 1, rowsToAppend.length, headers.length)
    .setValues(rowsToAppend);
}

function getProviderRecordByPhone_(phoneRaw) {
  const phone10 = normalizeIndianMobile_(phoneRaw);
  console.log("[getProviderRecordByPhone_] lookup", {
    rawPhone: String(phoneRaw || ""),
    normalizedPhone: phone10,
  });
  if (!phone10) return { ok: false, error: "INVALID_PHONE" };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TAB_PROVIDERS);
  if (!sh) return { ok: false, error: "PROVIDERS_SHEET_NOT_FOUND", sheet: TAB_PROVIDERS };

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: "NO_PROVIDERS" };

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] || [];
  const ensuredHeaders = ensureSheetHeaders_(sh, [
    "ProviderID",
    "ProviderName",
    "Phone",
    "Category",
    "Areas",
    "Verified",
    "OtpVerified",
    "OtpVerifiedAt",
    "LastLoginAt",
    "Status",
    "ApprovalStatus",
    "PendingApproval",
    "CustomCategory",
    "CreatedAt",
    "UpdatedAt",
  ]);
  const headerMap = getProviderHeaderMap_(ensuredHeaders);

  if (headerMap.phone === -1 || headerMap.providerId === -1 || headerMap.providerName === -1) {
    return {
      ok: false,
      error: "PROVIDERS_HEADERS_MISSING",
      debug: { headers: headers, headerMap: headerMap },
    };
  }

  const rows = sh.getRange(2, 1, lastRow - 1, headers.length).getValues();
  let foundRowNumber = -1;
  let foundRow = null;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const rowPhone10 =
      headerMap.phone !== -1 ? normalizeIndianMobile_(row[headerMap.phone]) : "";
    if (rowPhone10 === phone10) {
      foundRowNumber = i + 2;
      foundRow = row;
      break;
    }
  }

  if (!foundRow) {
    console.log("[getProviderRecordByPhone_] no match", {
      normalizedPhone: phone10,
    });
    return { ok: false, error: "PROVIDER_NOT_FOUND", phone: phone10 };
  }

  const providerId = String(foundRow[headerMap.providerId] || "").trim();
  const providerName = String(foundRow[headerMap.providerName] || "").trim();
  const verifiedRaw =
    headerMap.verified !== -1 ? String(foundRow[headerMap.verified] || "").trim() : "no";
  const otpVerifiedRaw =
    headerMap.otpVerified !== -1 ? String(foundRow[headerMap.otpVerified] || "").trim() : "no";
  const otpVerifiedAtRaw =
    headerMap.otpVerifiedAt !== -1 ? String(foundRow[headerMap.otpVerifiedAt] || "").trim() : "";
  const lastLoginAtRaw =
    headerMap.lastLoginAt !== -1 ? String(foundRow[headerMap.lastLoginAt] || "").trim() : "";
  const approvalRaw =
    headerMap.pendingApproval !== -1
      ? String(foundRow[headerMap.pendingApproval] || "").trim()
      : headerMap.approvalStatus !== -1
      ? String(foundRow[headerMap.approvalStatus] || "").trim().toLowerCase() === "pending"
        ? "yes"
        : "no"
      : "no";
  const statusRaw =
    headerMap.status !== -1 ? String(foundRow[headerMap.status] || "").trim() : "";

  console.log("[getProviderRecordByPhone_] matched row", {
    ProviderID: providerId,
    Phone: phone10,
    rowNumber: foundRowNumber,
  });

  return {
    ok: true,
    rowNumber: foundRowNumber,
    headers: headers,
    headerMap: headerMap,
    provider: {
      ProviderID: providerId,
      ProviderName: providerName,
      Name: providerName,
      Phone: phone10,
      Verified: normalizeVerifiedProviderValue_(verifiedRaw) || "no",
      OtpVerified: normalizeOtpVerifiedValue_(otpVerifiedRaw) || "no",
      OtpVerifiedAt: otpVerifiedAtRaw,
      LastLoginAt: lastLoginAtRaw,
      PendingApproval: approvalRaw.toLowerCase() === "yes" ? "yes" : "no",
      Status: statusRaw,
    },
  };
}

function providerRegister(phoneRaw, providerName, categories, areas) {
  const phone = normalizePhone10_(phoneRaw);
  if (!phone) return { ok: false, status: "error", error: "Invalid phone number" };

  providerName = String(providerName || "").trim();
  if (!providerName) return { ok: false, status: "error", error: "ProviderName required" };

  if (!Array.isArray(categories) || categories.length === 0) return { ok: false, status: "error", error: "No categories" };
  if (!Array.isArray(areas) || areas.length === 0) return { ok: false, status: "error", error: "No areas" };

  if (categories.length > 3) return { ok: false, status: "error", error: "Max 3 categories" };
  if (areas.length > 5) return { ok: false, status: "error", error: "Max 5 areas" };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const providersSheet = getOrCreateSheet(SHEET_PROVIDERS, [
    "ProviderID",
    "ProviderName",
    "Phone",
    "Category",
    "Areas",
    "Verified",
    "OtpVerified",
    "OtpVerifiedAt",
    "LastLoginAt",
    "Status",
    "ApprovalStatus",
    "PendingApproval",
    "CustomCategory",
    "CreatedAt",
    "UpdatedAt",
  ]);
  const servicesSheet = getOrCreateSheet(SHEET_PROVIDER_SERVICES, [
    "ProviderID",
    "ServiceName",
    "IsActive",
    "Source",
    "CreatedAt",
    "UpdatedAt",
  ]);
  const areasSheet = getOrCreateSheet(SHEET_PROVIDER_AREAS, [
    "ProviderID",
    "AreaName",
    "IsActive",
    "Source",
    "CreatedAt",
    "UpdatedAt",
  ]);

  const providerHeaders = ensureSheetHeaders_(providersSheet, [
    "ProviderID",
    "ProviderName",
    "Phone",
    "Category",
    "Areas",
    "Verified",
    "OtpVerified",
    "OtpVerifiedAt",
    "LastLoginAt",
    "Status",
    "ApprovalStatus",
    "PendingApproval",
    "CustomCategory",
    "CreatedAt",
    "UpdatedAt",
  ]);
  const providerRows = providersSheet.getDataRange().getValues();
  const providerHeaderMap = getProviderHeaderMap_(providerHeaders);

  const cleanCats = uniqueNormalizedValues_(categories);
  const requestedAreaKeys = new Set();
  const requestedNewAreas = [];
  const approvedResolvedAreas = [];
  const rawAreas = Array.isArray(areas) ? areas : [];

  rawAreas.forEach((areaValue) => {
    const normalizedArea = normalizeAreaName_(areaValue);
    const resolution = getAreaResolution_(normalizedArea);
    const areaLookupKey = resolution.normalizedKey;
    if (!resolution.rawArea || !areaLookupKey) return;

    if (resolution.known) {
      approvedResolvedAreas.push(resolution.resolvedArea);
      return;
    }

    if (requestedAreaKeys.has(areaLookupKey)) return;
    requestedAreaKeys.add(areaLookupKey);
    requestedNewAreas.push(resolution.rawArea);
  });

  const cleanAreas = uniqueNormalizedAreaValues_(approvedResolvedAreas);
  const approvedLookup = getApprovedCategoriesLookup_();
  const requestedNewCategories = cleanCats.filter(
    (category) => !approvedLookup[getNormalizedCategoryKey_(category)]
  );
  const allCategoriesApproved = requestedNewCategories.length === 0;
  const hasNewAreaRequests = requestedNewAreas.length > 0;
  const requiresAdminApproval = !allCategoriesApproved || hasNewAreaRequests;
  const pendingApproval = requiresAdminApproval ? "yes" : "no";
  const message = !allCategoriesApproved && hasNewAreaRequests
    ? "Registration successful. Your new category and area requests are pending admin approval. Approved areas are active now."
    : !allCategoriesApproved
      ? "Application submitted successfully. Your new category request is pending admin approval."
      : hasNewAreaRequests
        ? "Registration successful. Your new area request is pending admin approval. Approved areas are active now."
        : "Registration successful.";

  const now = new Date();
  let providerRow = -1;
  let providerId = "";

  for (let i = 1; i < providerRows.length; i++) {
    const row = providerRows[i] || [];
    const rowPhone =
      providerHeaderMap.phone !== -1 ? normalizePhone10_(row[providerHeaderMap.phone]) : "";
    if (rowPhone === phone) {
      providerRow = i + 1;
      providerId =
        providerHeaderMap.providerId !== -1
          ? String(row[providerHeaderMap.providerId] || "").trim()
          : "";
      break;
    }
  }

  if (!providerId) {
    providerId = nextProviderId_(providersSheet);
  }

  const existingRow = providerRow !== -1 ? providerRows[providerRow - 1] || [] : [];
  const existingVerified =
    providerRow !== -1 && providerHeaderMap.verified !== -1
      ? String(existingRow[providerHeaderMap.verified] || "").trim().toLowerCase()
      : "";
  const existingApprovalStatus =
    providerRow !== -1 && providerHeaderMap.approvalStatus !== -1
      ? String(existingRow[providerHeaderMap.approvalStatus] || "").trim().toLowerCase()
      : "";
  const verified = existingVerified === "yes" ? "yes" : "no";
  const approvalStatus = requiresAdminApproval
    ? "pending"
    : existingApprovalStatus === "approved"
      ? "approved"
      : "";

  const providerData = {
    ProviderID: providerId,
    Name: providerName,
    Phone: phone,
    Category: cleanCats.join(", "),
    Areas: cleanAreas.join(", "),
    Verified: verified,
    OtpVerified: providerRow !== -1 && providerHeaderMap.otpVerified !== -1
      ? normalizeOtpVerifiedValue_(providerRows[providerRow - 1]?.[providerHeaderMap.otpVerified] || "") || "no"
      : "no",
    OtpVerifiedAt: providerRow !== -1 && providerHeaderMap.otpVerifiedAt !== -1
      ? providerRows[providerRow - 1]?.[providerHeaderMap.otpVerifiedAt] || ""
      : "",
    LastLoginAt: providerRow !== -1 && providerHeaderMap.lastLoginAt !== -1
      ? providerRows[providerRow - 1]?.[providerHeaderMap.lastLoginAt] || ""
      : "",
    Status: pendingApproval === "yes" ? "Pending Admin Approval" : "Active",
    ApprovalStatus: approvalStatus,
    PendingApproval: pendingApproval,
    CustomCategory: requestedNewCategories.join(", "),
    UpdatedAt: now,
  };

  if (providerRow === -1) {
    providerData.CreatedAt = now;
  }

  upsertProviderSheetRow_(providersSheet, providerHeaders, providerRow, providerData);

  deleteRowsByProvider_(servicesSheet, providerId);
  deleteRowsByProvider_(areasSheet, providerId);

  cleanCats.forEach((cat) => {
    servicesSheet.appendRow([providerId, cat, "yes", "self_registered", now, now]);
  });

  cleanAreas.forEach((aName) => {
    aName = String(aName || "").trim();
    if (!aName) return;
    areasSheet.appendRow([providerId, aName, "yes", "self_registered", now, now]);
  });

  requestedNewAreas.forEach((rawArea) => {
    queueAreaReviewItemSafe_(rawArea, {
      sourceType: "provider_area",
      sourceRef: providerId,
    });
  });

  upsertCategoryApplications_(providerId, providerName, phone, requestedNewCategories, now);

  return {
    ok: true,
    status: "success",
    providerId: providerId,
    verified: verified,
    pendingApproval: pendingApproval,
    requiresAdminApproval: requiresAdminApproval,
    requestedNewCategories: requestedNewCategories,
    requestedNewAreas: requestedNewAreas,
    message: message,
    provider: {
      ProviderID: providerId,
      ProviderName: providerName,
      Name: providerName,
      Phone: phone,
      Verified: verified,
      PendingApproval: pendingApproval,
      Status: pendingApproval === "yes" ? "Pending Admin Approval" : "Active",
    },
  };
}

/*************************************************
 * PROVIDERS (Profile / Leads)
 *************************************************/
function getProviderByPhone_(phoneRaw) {
  const record = getProviderRecordByPhone_(phoneRaw);
  if (!record.ok) return record;

  const services = getProviderServices_(record.provider.ProviderID);
  const areas = getProviderAreas_(record.provider.ProviderID);
  const areaCoverage = getProviderAreaCoverageStatus_(record.provider.ProviderID, areas);
  const analytics = getProviderDashboardAnalytics_(
    record.provider.ProviderID,
    services,
    areas
  );

  return {
    ok: true,
    provider: {
      ProviderID: record.provider.ProviderID,
      ProviderName: record.provider.ProviderName,
      Phone: record.provider.Phone,
      Verified: record.provider.Verified,
      OtpVerified: record.provider.OtpVerified,
      OtpVerifiedAt: record.provider.OtpVerifiedAt,
      LastLoginAt: record.provider.LastLoginAt,
      PendingApproval: record.provider.PendingApproval,
      Status: record.provider.Status,
      Services: services,
      Areas: areas,
      AreaCoverage: areaCoverage,
      Analytics: analytics,
    }
  };
}

function getProviderProfile_(phoneRaw) {
  return getProviderByPhone_(phoneRaw);
}

function getAdminByPhone_(phoneRaw) {
  const phone10 = normalizeIndianMobile_(phoneRaw);
  if (!phone10) {
    return { ok: false, error: "INVALID_PHONE" };
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Admins");
  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: false, error: "ACCESS_DENIED" };
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const idxPhone = findHeaderIndexByAliases_(headers, ["Phone", "Mobile"]);
  const idxName = findHeaderIndexByAliases_(headers, ["Name", "AdminName"]);
  const idxRole = findHeaderIndexByAliases_(headers, ["Role"]);
  const idxPermissions = findHeaderIndexByAliases_(headers, ["Permissions", "Permission"]);
  const idxActive = findHeaderIndexByAliases_(headers, ["Active", "IsActive", "Status"]);

  if (idxPhone === -1) {
    return { ok: false, error: "ACCESS_DENIED" };
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const rowPhone = normalizeIndianMobile_(row[idxPhone]);
    if (rowPhone !== phone10) continue;

    const activeRaw =
      idxActive !== -1 && row[idxActive] !== undefined
        ? String(row[idxActive]).trim().toLowerCase()
        : "yes";
    const isActive =
      activeRaw === "" ||
      activeRaw === "yes" ||
      activeRaw === "true" ||
      activeRaw === "1" ||
      activeRaw === "active";
    if (!isActive) {
      return { ok: false, error: "ACCESS_DENIED" };
    }

    const roleRaw =
      idxRole !== -1 && row[idxRole] !== undefined
        ? String(row[idxRole]).trim().toLowerCase()
        : "";
    const role = roleRaw || "admin";
    if (role !== "admin" && role !== "superadmin") {
      return { ok: false, error: "ACCESS_DENIED" };
    }

    const permissionsRaw =
      idxPermissions !== -1 && row[idxPermissions] !== undefined
        ? String(row[idxPermissions]).trim()
        : "";
    const permissions = permissionsRaw
      ? permissionsRaw
          .split(",")
          .map((value) => String(value || "").trim())
          .filter(Boolean)
      : ["view_tasks", "view_chats", "view_reviews", "manage_roles"];

    return {
      ok: true,
      admin: {
        name:
          idxName !== -1 && row[idxName] !== undefined
            ? String(row[idxName]).trim() || "Admin"
            : "Admin",
        phone: phone10,
        role: role,
        permissions: permissions,
      },
    };
  }

  return { ok: false, error: "ACCESS_DENIED" };
}

function getAdminTeamMembers_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Admins");
  if (!sheet || sheet.getLastRow() < 2) {
    return { ok: true, status: "success", members: [] };
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const idxPhone = findHeaderIndexByAliases_(headers, ["Phone", "Mobile"]);
  const idxName = findHeaderIndexByAliases_(headers, ["Name", "AdminName"]);
  const idxRole = findHeaderIndexByAliases_(headers, ["Role"]);
  const idxPermissions = findHeaderIndexByAliases_(headers, ["Permissions", "Permission"]);
  const idxActive = findHeaderIndexByAliases_(headers, ["Active", "IsActive", "Status"]);
  const idxTimestamp = findHeaderIndexByAliases_(headers, [
    "Timestamp",
    "CreatedAt",
    "UpdatedAt",
  ]);

  if (idxPhone === -1) {
    return { ok: false, status: "error", error: "Admins sheet missing Phone column" };
  }

  const members = rows
    .map(function (row) {
      const phone = normalizeIndianMobile_(row[idxPhone]);
      if (!phone) return null;

      const name =
        idxName !== -1 && row[idxName] !== undefined
          ? String(row[idxName]).trim()
          : "";
      const roleRaw =
        idxRole !== -1 && row[idxRole] !== undefined
          ? String(row[idxRole]).trim().toLowerCase()
          : "";
      const permissionsRaw =
        idxPermissions !== -1 && row[idxPermissions] !== undefined
          ? String(row[idxPermissions]).trim()
          : "";
      const activeRaw =
        idxActive !== -1 && row[idxActive] !== undefined
          ? String(row[idxActive]).trim().toLowerCase()
          : "yes";
      const timestamp =
        idxTimestamp !== -1 && row[idxTimestamp] !== undefined
          ? String(row[idxTimestamp]).trim()
          : "";

      return {
        name: name || "Admin",
        phone: phone,
        role: roleRaw || "admin",
        permissions: permissionsRaw
          ? permissionsRaw
              .split(",")
              .map(function (value) {
                return String(value || "").trim();
              })
              .filter(Boolean)
          : [],
        active:
          activeRaw === "" ||
          activeRaw === "yes" ||
          activeRaw === "true" ||
          activeRaw === "1" ||
          activeRaw === "active",
        timestamp: timestamp,
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return String(a.name || "").localeCompare(String(b.name || ""));
    });

  return { ok: true, status: "success", members: members };
}

function getAdminCategoryApplications_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName("CategoryApplications");
  if (!sheet || sheet.getLastRow() < 2) return [];

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const idxRequestId = findHeaderIndexByAliases_(headers, ["RequestID"]);
  const idxProviderName = findHeaderIndexByAliases_(headers, ["ProviderName", "Name"]);
  const idxPhone = findHeaderIndexByAliases_(headers, ["Phone", "ProviderPhone"]);
  const idxRequestedCategory = findHeaderIndexByAliases_(headers, ["RequestedCategory", "Category"]);
  const idxStatus = findHeaderIndexByAliases_(headers, ["Status"]);
  const idxCreatedAt = findHeaderIndexByAliases_(headers, ["CreatedAt", "Timestamp"]);
  const idxUpdatedAt = findHeaderIndexByAliases_(headers, ["UpdatedAt"]);
  const idxSource = findHeaderIndexByAliases_(headers, ["Source"]);
  const idxTaskId = findHeaderIndexByAliases_(headers, ["TaskID"]);
  const idxAdminActionBy = findHeaderIndexByAliases_(headers, ["AdminActionBy"]);
  const idxAdminActionAt = findHeaderIndexByAliases_(headers, ["AdminActionAt"]);
  const idxAdminActionReason = findHeaderIndexByAliases_(headers, ["AdminActionReason"]);

  return rows
    .map((row) => ({
      RequestID:
        idxRequestId !== -1 && row[idxRequestId] !== undefined
          ? String(row[idxRequestId]).trim()
          : "",
      ProviderName:
        idxProviderName !== -1 && row[idxProviderName] !== undefined
          ? String(row[idxProviderName]).trim()
          : "",
      Phone:
        idxPhone !== -1 && row[idxPhone] !== undefined ? String(row[idxPhone]).trim() : "",
      RequestedCategory:
        idxRequestedCategory !== -1 && row[idxRequestedCategory] !== undefined
          ? String(row[idxRequestedCategory]).trim()
          : "",
      Status:
        idxStatus !== -1 && row[idxStatus] !== undefined ? String(row[idxStatus]).trim() : "",
      CreatedAt:
        idxCreatedAt !== -1 && row[idxCreatedAt] !== undefined
          ? String(row[idxCreatedAt]).trim()
          : "",
      UpdatedAt:
        idxUpdatedAt !== -1 && row[idxUpdatedAt] !== undefined
          ? String(row[idxUpdatedAt]).trim()
          : "",
      Source:
        idxSource !== -1 && row[idxSource] !== undefined
          ? String(row[idxSource]).trim()
          : "",
      TaskID:
        idxTaskId !== -1 && row[idxTaskId] !== undefined
          ? String(row[idxTaskId]).trim()
          : "",
      AdminActionBy:
        idxAdminActionBy !== -1 && row[idxAdminActionBy] !== undefined
          ? String(row[idxAdminActionBy]).trim()
          : "",
      AdminActionAt:
        idxAdminActionAt !== -1 && row[idxAdminActionAt] !== undefined
          ? String(row[idxAdminActionAt]).trim()
          : "",
      AdminActionReason:
        idxAdminActionReason !== -1 && row[idxAdminActionReason] !== undefined
          ? String(row[idxAdminActionReason]).trim()
          : "",
    }))
    .filter((item) => item.RequestID || item.ProviderName || item.RequestedCategory)
    .filter((item) => String(item.Status).trim().toLowerCase() === "pending")
    .sort((a, b) => String(b.CreatedAt).localeCompare(String(a.CreatedAt)));
}

function ensureCategoryExists_(categoryName) {
  const normalizedCategoryName = normalizeCategoryName_(categoryName);
  if (!normalizedCategoryName) {
    return { ok: false, status: "error", error: "CategoryName required" };
  }

  const sheet = getOrCreateSheet(SHEET_CATEGORIES, ["CategoryName", "Active"]);
  const headers = ensureSheetHeaders_(sheet, ["CategoryName", "Active"]);
  const values = sheet.getDataRange().getValues();
  const idxName = findHeaderIndexByAliases_(headers, [
    "CategoryName",
    "category_name",
    "Category",
    "Name",
    "Service",
  ]);
  const idxStatus = findHeaderIndexByAliases_(headers, ["Status"]);
  const idxActive = findHeaderIndexByAliases_(headers, ["Active"]);

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const existingName =
      idxName !== -1 && row[idxName] !== undefined ? normalizeCategoryName_(row[idxName]) : "";
    if (existingName.toLowerCase() !== normalizedCategoryName.toLowerCase()) continue;

    const updates = {};
    if (idxStatus !== -1) updates.Status = "approved";
    if (idxActive !== -1) updates.Active = "yes";
    if (Object.keys(updates).length) {
      updateRowFromData_(sheet, i + 1, updates);
    }

    return { ok: true, created: false, categoryName: normalizedCategoryName };
  }

  const rowData = {
    CategoryName: normalizedCategoryName,
    Active: "yes",
  };
  if (idxStatus !== -1) rowData.Status = "approved";
  if (findHeaderIndexByAliases_(headers, ["CreatedAt", "Timestamp"]) !== -1) {
    rowData.CreatedAt = new Date();
  }
  if (findHeaderIndexByAliases_(headers, ["UpdatedAt"]) !== -1) {
    rowData.UpdatedAt = new Date();
  }

  sheet.appendRow(buildRowFromData_(headers, rowData));
  return { ok: true, created: true, categoryName: normalizedCategoryName };
}

function getCategoryApplicationsState_() {
  const sheet = getOrCreateSheet("CategoryApplications", [
    "RequestID",
    "ProviderID",
    "ProviderName",
    "Phone",
    "RequestedCategory",
    "Status",
    "CreatedAt",
    "UpdatedAt",
    "Source",
    "TaskID",
    "AdminActionBy",
    "AdminActionAt",
    "AdminActionReason",
  ]);
  const headers = ensureSheetHeaders_(sheet, [
    "RequestID",
    "ProviderID",
    "ProviderName",
    "Phone",
    "RequestedCategory",
    "Status",
    "CreatedAt",
    "UpdatedAt",
    "Source",
    "TaskID",
    "AdminActionBy",
    "AdminActionAt",
    "AdminActionReason",
  ]);
  const values = sheet.getDataRange().getValues();

  return {
    sheet: sheet,
    headers: headers,
    values: values,
    idxRequestId: findHeaderIndexByAliases_(headers, ["RequestID"]),
    idxProviderId: findHeaderIndexByAliases_(headers, ["ProviderID"]),
    idxPhone: findHeaderIndexByAliases_(headers, ["Phone", "ProviderPhone"]),
    idxCategory: findHeaderIndexByAliases_(headers, ["RequestedCategory", "Category"]),
    idxStatus: findHeaderIndexByAliases_(headers, ["Status"]),
    idxUpdatedAt: findHeaderIndexByAliases_(headers, ["UpdatedAt"]),
    idxSource: findHeaderIndexByAliases_(headers, ["Source"]),
    idxTaskId: findHeaderIndexByAliases_(headers, ["TaskID"]),
    idxAdminActionBy: findHeaderIndexByAliases_(headers, ["AdminActionBy"]),
    idxAdminActionAt: findHeaderIndexByAliases_(headers, ["AdminActionAt"]),
    idxAdminActionReason: findHeaderIndexByAliases_(headers, ["AdminActionReason"]),
  };
}

function getProviderSheetState_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(TAB_PROVIDERS);
  if (!sheet) {
    return {
      sheet: null,
      headers: [],
      values: [],
      headerMap: getProviderHeaderMap_([]),
    };
  }
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];

  return {
    sheet: sheet,
    headers: headers,
    values: sheet.getDataRange().getValues(),
    headerMap: getProviderHeaderMap_(headers),
  };
}

function findProviderSheetRowState_(providerState, providerId, phone) {
  const normalizedProviderId = String(providerId || "").trim();
  const normalizedPhone = normalizePhone10_(phone);

  if (!providerState || !providerState.sheet || !providerState.values.length) {
    return { ok: false, status: "error", error: "Providers sheet not found" };
  }

  for (let i = 1; i < providerState.values.length; i++) {
    const row = providerState.values[i] || [];
    const rowProviderId =
      providerState.headerMap.providerId !== -1 &&
      row[providerState.headerMap.providerId] !== undefined
        ? String(row[providerState.headerMap.providerId]).trim()
        : "";
    const rowPhone =
      providerState.headerMap.phone !== -1 && row[providerState.headerMap.phone] !== undefined
        ? normalizePhone10_(row[providerState.headerMap.phone])
        : "";

    if (normalizedProviderId && rowProviderId === normalizedProviderId) {
      return { ok: true, rowNumber: i + 1, row: row, matchedBy: "providerId" };
    }
    if (!normalizedProviderId && normalizedPhone && rowPhone === normalizedPhone) {
      return { ok: true, rowNumber: i + 1, row: row, matchedBy: "phone" };
    }
  }

  if (normalizedPhone) {
    for (let i = 1; i < providerState.values.length; i++) {
      const row = providerState.values[i] || [];
      const rowPhone =
        providerState.headerMap.phone !== -1 && row[providerState.headerMap.phone] !== undefined
          ? normalizePhone10_(row[providerState.headerMap.phone])
          : "";
      if (rowPhone === normalizedPhone) {
        return { ok: true, rowNumber: i + 1, row: row, matchedBy: "phone" };
      }
    }
  }

  return { ok: false, status: "error", error: "Provider not found for approval sync" };
}

function writeProviderVerifiedValue_(providerState, rowNumber, verifiedValue) {
  if (!providerState || !providerState.sheet) {
    return { ok: false, status: "error", error: "Providers sheet not found" };
  }
  if (providerState.headerMap.verified === -1) {
    return { ok: false, status: "error", error: "Verified column missing in Providers sheet" };
  }

  providerState.sheet
    .getRange(rowNumber, providerState.headerMap.verified + 1)
    .setValue(String(verifiedValue || "").trim().toLowerCase() === "yes" ? "yes" : "no");

  if (providerState.headerMap.updatedAt !== -1) {
    providerState.sheet.getRange(rowNumber, providerState.headerMap.updatedAt + 1).setValue(new Date());
  }

  return { ok: true, status: "success" };
}

function writeProviderApprovalState_(providerState, rowNumber, data) {
  if (!providerState || !providerState.sheet) {
    return { ok: false, status: "error", error: "Providers sheet not found" };
  }

  const updates = {};
  if (data && data.pendingApproval !== undefined && providerState.headerMap.pendingApproval !== -1) {
    updates.PendingApproval =
      String(data.pendingApproval || "").trim().toLowerCase() === "yes" ? "yes" : "no";
  }
  if (data && data.approvalStatus !== undefined && providerState.headerMap.approvalStatus !== -1) {
    updates.ApprovalStatus = String(data.approvalStatus || "").trim().toLowerCase();
  }
  if (data && data.status !== undefined && providerState.headerMap.status !== -1) {
    updates.Status = String(data.status || "").trim();
  }
  if (!Object.keys(updates).length) {
    return { ok: true, status: "success" };
  }

  updateRowFromData_(providerState.sheet, rowNumber, updates);
  return { ok: true, status: "success" };
}

function getCategoryApplicationProviderSummary_(providerId, phone) {
  const state = getCategoryApplicationsState_();
  const normalizedProviderId = String(providerId || "").trim();
  const normalizedPhone = normalizePhone10_(phone);
  const pendingCategories = [];
  const seenPending = {};

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const rowProviderId =
      state.idxProviderId !== -1 && row[state.idxProviderId] !== undefined
        ? String(row[state.idxProviderId]).trim()
        : "";
    const rowPhone =
      state.idxPhone !== -1 && row[state.idxPhone] !== undefined
        ? normalizePhone10_(row[state.idxPhone])
        : "";
    const sameProvider =
      (normalizedProviderId && rowProviderId === normalizedProviderId) ||
      (normalizedPhone && rowPhone === normalizedPhone);

    if (!sameProvider) continue;

    const status =
      state.idxStatus !== -1 && row[state.idxStatus] !== undefined
        ? String(row[state.idxStatus]).trim().toLowerCase()
        : "";
    if (status !== "pending") continue;

    const categoryName =
      state.idxCategory !== -1 && row[state.idxCategory] !== undefined
        ? normalizeCategoryName_(row[state.idxCategory])
        : "";
    const categoryKey = getNormalizedCategoryKey_(categoryName);
    if (!categoryKey || seenPending[categoryKey]) continue;

    seenPending[categoryKey] = true;
    pendingCategories.push(categoryName);
  }

  return {
    pendingCategories: pendingCategories,
  };
}

function buildPendingCategorySummaryLookup_() {
  const state = getCategoryApplicationsState_();
  const byProviderId = {};
  const byPhone = {};

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const status =
      state.idxStatus !== -1 && row[state.idxStatus] !== undefined
        ? String(row[state.idxStatus]).trim().toLowerCase()
        : "";
    if (status !== "pending") continue;

    const providerId =
      state.idxProviderId !== -1 && row[state.idxProviderId] !== undefined
        ? String(row[state.idxProviderId]).trim()
        : "";
    const phone =
      state.idxPhone !== -1 && row[state.idxPhone] !== undefined
        ? normalizePhone10_(row[state.idxPhone])
        : "";
    const categoryName =
      state.idxCategory !== -1 && row[state.idxCategory] !== undefined
        ? normalizeCategoryName_(row[state.idxCategory])
        : "";
    const categoryKey = getNormalizedCategoryKey_(categoryName);

    if (!categoryKey) continue;

    if (providerId) {
      if (!byProviderId[providerId]) byProviderId[providerId] = { categories: [], seen: {} };
      if (!byProviderId[providerId].seen[categoryKey]) {
        byProviderId[providerId].seen[categoryKey] = true;
        byProviderId[providerId].categories.push(categoryName);
      }
    }

    if (phone) {
      if (!byPhone[phone]) byPhone[phone] = { categories: [], seen: {} };
      if (!byPhone[phone].seen[categoryKey]) {
        byPhone[phone].seen[categoryKey] = true;
        byPhone[phone].categories.push(categoryName);
      }
    }
  }

  return {
    byProviderId: byProviderId,
    byPhone: byPhone,
  };
}

function syncProviderApprovalState_(providerId, phone, options) {
  const providerState = getProviderSheetState_();
  const normalizedProviderId = String(providerId || "").trim();
  const normalizedPhone = normalizePhone10_(phone);

  if (!providerState.sheet || !providerState.values.length) {
    return { ok: false, status: "error", error: "Providers sheet not found" };
  }
  if (!normalizedProviderId && !normalizedPhone) {
    return { ok: false, status: "error", error: "Provider reference required" };
  }

  const target = findProviderSheetRowState_(providerState, normalizedProviderId, normalizedPhone);
  if (!target.ok) {
    return target;
  }

  const summary = getCategoryApplicationProviderSummary_(normalizedProviderId, normalizedPhone);
  const hasPendingCategories = summary.pendingCategories.length > 0;
  const currentVerified =
    providerState.headerMap.verified !== -1 &&
    target.row[providerState.headerMap.verified] !== undefined
      ? String(target.row[providerState.headerMap.verified]).trim().toLowerCase()
      : "no";
  const currentPendingApproval =
    providerState.headerMap.pendingApproval !== -1 &&
    target.row[providerState.headerMap.pendingApproval] !== undefined
      ? String(target.row[providerState.headerMap.pendingApproval]).trim().toLowerCase()
      : "no";
  const currentApprovalStatus =
    providerState.headerMap.approvalStatus !== -1 &&
    target.row[providerState.headerMap.approvalStatus] !== undefined
      ? String(target.row[providerState.headerMap.approvalStatus]).trim().toLowerCase()
      : "";
  const currentStatus =
    providerState.headerMap.status !== -1 && target.row[providerState.headerMap.status] !== undefined
      ? String(target.row[providerState.headerMap.status]).trim()
      : "";
  const nextPendingApproval = hasPendingCategories ? "yes" : "no";
  const nextApprovalStatus = hasPendingCategories ? "pending" : "approved";
  const nextProviderStatus = hasPendingCategories ? "Pending Admin Approval" : "Active";
  let nextVerified = currentVerified;

  if (
    currentPendingApproval !== nextPendingApproval ||
    currentApprovalStatus !== nextApprovalStatus ||
    currentStatus !== nextProviderStatus
  ) {
    const approvalWriteResult = writeProviderApprovalState_(providerState, target.rowNumber, {
      pendingApproval: nextPendingApproval,
      approvalStatus: nextApprovalStatus,
      status: nextProviderStatus,
    });
    if (!approvalWriteResult.ok) return approvalWriteResult;
  }

  if (options && options.markVerifiedApproved === true && !hasPendingCategories && currentVerified !== "yes") {
    const writeResult = writeProviderVerifiedValue_(providerState, target.rowNumber, "yes");
    if (!writeResult.ok) return writeResult;
    nextVerified = "yes";
  }

  return {
    ok: true,
    status: "success",
    providerId:
      providerState.headerMap.providerId !== -1 &&
      target.row[providerState.headerMap.providerId] !== undefined
        ? String(target.row[providerState.headerMap.providerId]).trim()
        : normalizedProviderId,
    verified: nextVerified,
    pendingApproval: nextPendingApproval,
    approvalStatus: nextApprovalStatus,
    providerStatus: nextProviderStatus,
    pendingCategories: summary.pendingCategories,
  };
}

function reconcileProviderApprovalStates_() {
  const lock = LockService.getScriptLock();
  const acquired = lock.tryLock(250);

  if (!acquired) {
    return { ok: true, status: "skipped", skipped: true, reason: "lock_unavailable" };
  }

  try {
    const providerState = getProviderSheetState_();
    if (!providerState.sheet || !providerState.values.length) {
      return { ok: false, status: "error", error: "Providers sheet not found" };
    }
    const pendingLookup = buildPendingCategorySummaryLookup_();
    let updatedCount = 0;

    for (let i = 1; i < providerState.values.length; i++) {
      const row = providerState.values[i] || [];
      const providerId =
        providerState.headerMap.providerId !== -1 &&
        row[providerState.headerMap.providerId] !== undefined
          ? String(row[providerState.headerMap.providerId]).trim()
          : "";
      const phone =
        providerState.headerMap.phone !== -1 && row[providerState.headerMap.phone] !== undefined
          ? normalizePhone10_(row[providerState.headerMap.phone])
          : "";
      const pendingSummary =
        (providerId && pendingLookup.byProviderId[providerId]) ||
        (phone && pendingLookup.byPhone[phone]) ||
        null;
      const pendingCategories = pendingSummary ? pendingSummary.categories.slice() : [];
      const hasPendingCategories = pendingCategories.length > 0;

      const currentPendingApproval =
        providerState.headerMap.pendingApproval !== -1 &&
        row[providerState.headerMap.pendingApproval] !== undefined
          ? String(row[providerState.headerMap.pendingApproval]).trim().toLowerCase()
          : "no";
      const currentApprovalStatus =
        providerState.headerMap.approvalStatus !== -1 &&
        row[providerState.headerMap.approvalStatus] !== undefined
          ? String(row[providerState.headerMap.approvalStatus]).trim().toLowerCase()
          : "";
      const currentStatus =
        providerState.headerMap.status !== -1 && row[providerState.headerMap.status] !== undefined
          ? String(row[providerState.headerMap.status]).trim()
          : "";
      const nextPendingApproval = hasPendingCategories ? "yes" : "no";
      const nextApprovalStatus = hasPendingCategories ? "pending" : "approved";
      const nextProviderStatus = hasPendingCategories ? "Pending Admin Approval" : "Active";
      const requiresUpdate =
        currentPendingApproval !== nextPendingApproval ||
        currentApprovalStatus !== nextApprovalStatus ||
        currentStatus !== nextProviderStatus;

      if (!requiresUpdate) continue;

      const writeResult = writeProviderApprovalState_(providerState, i + 1, {
        pendingApproval: nextPendingApproval,
        approvalStatus: nextApprovalStatus,
        status: nextProviderStatus,
      });
      if (!writeResult.ok) return writeResult;
      updatedCount += 1;
    }

    return { ok: true, status: "success", updatedCount: updatedCount };
  } finally {
    if (acquired) {
      lock.releaseLock();
    }
  }
}

function resolveAdminActionActor_(data) {
  const actorBy = String(
    (data && (data.AdminActionBy || data.adminActionBy || data.AdminActorName || data.adminActorName)) || ""
  ).trim();
  const actorPhone = normalizePhone10_(
    data &&
      (data.AdminActionPhone ||
        data.adminActionPhone ||
        data.AdminActorPhone ||
        data.adminActorPhone ||
        data.phone)
  );

  return actorBy || actorPhone || "admin";
}

function updateCategoryApplicationStatus_(requestId, status, options) {
  const normalizedRequestId = String(requestId || "").trim();
  const normalizedStatus = String(status || "").trim().toLowerCase();
  if (!normalizedRequestId) {
    return { ok: false, status: "error", error: "RequestID required" };
  }
  if (!normalizedStatus) {
    return { ok: false, status: "error", error: "Status required" };
  }

  const state = getCategoryApplicationsState_();
  if (!state.sheet || state.values.length < 2) {
    return { ok: false, status: "error", error: "CategoryApplications sheet not found" };
  }

  if (state.idxRequestId === -1) {
    return { ok: false, status: "error", error: "RequestID column missing" };
  }

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const rowRequestId =
      row[state.idxRequestId] !== undefined ? String(row[state.idxRequestId]).trim() : "";
    if (rowRequestId !== normalizedRequestId) continue;

    const providerId =
      state.idxProviderId !== -1 && row[state.idxProviderId] !== undefined
        ? String(row[state.idxProviderId]).trim()
        : "";
    const phone =
      state.idxPhone !== -1 && row[state.idxPhone] !== undefined ? String(row[state.idxPhone]).trim() : "";
    const requestedCategory =
      state.idxCategory !== -1 && row[state.idxCategory] !== undefined
        ? normalizeCategoryName_(row[state.idxCategory])
        : "";
    const previousStatus =
      state.idxStatus !== -1 && row[state.idxStatus] !== undefined
        ? String(row[state.idxStatus]).trim().toLowerCase()
        : "";
    const updates = {
      Status: normalizedStatus,
      UpdatedAt: new Date(),
    };
    if (options && Object.prototype.hasOwnProperty.call(options, "adminActionBy")) {
      updates.AdminActionBy = options.adminActionBy || "";
    }
    if (options && Object.prototype.hasOwnProperty.call(options, "adminActionAt")) {
      updates.AdminActionAt = options.adminActionAt || "";
    }
    if (options && Object.prototype.hasOwnProperty.call(options, "adminActionReason")) {
      updates.AdminActionReason = options.adminActionReason || "";
    }

    updateRowFromData_(state.sheet, i + 1, updates);
    return {
      ok: true,
      requestId: normalizedRequestId,
      updatedStatus: normalizedStatus,
      previousStatus: previousStatus,
      providerId: providerId,
      phone: phone,
      requestedCategory: requestedCategory,
    };
  }

  return { ok: false, status: "error", error: "Category request not found" };
}

function approveCategoryRequest_(data) {
  const requestId = String(data.requestId || "").trim();
  const categoryName = String(data.categoryName || "").trim();

  if (!requestId) return { ok: false, status: "error", error: "RequestID required" };
  if (!categoryName) return { ok: false, status: "error", error: "CategoryName required" };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const categoryResult = ensureCategoryExists_(categoryName);
    if (!categoryResult.ok) return categoryResult;

    const requestResult = updateCategoryApplicationStatus_(requestId, "approved", {
      adminActionBy: resolveAdminActionActor_(data),
      adminActionAt: new Date(),
      adminActionReason: String(data.reason || data.adminActionReason || "").trim(),
    });
    if (!requestResult.ok) return requestResult;

    if (typeof appendModerationLog_ === "function") {
      appendModerationLog_({
        ThreadID: "",
        MessageID: "",
        ActorType: "admin",
        ActorId: resolveAdminActionActor_(data),
        EventType: "category_request_approved",
        Severity: "info",
        Reason: String(data.reason || data.adminActionReason || "").trim(),
        ActionTaken: "approved",
        Metadata: JSON.stringify({
          requestId: requestId,
          categoryName: categoryResult.categoryName,
          providerId: requestResult.providerId || "",
        }),
      });
    }

    // Skip provider sync for task-originated entries (no ProviderID)
    if (!requestResult.providerId) {
      return {
        ok: true,
        status: "success",
        requestId: requestId,
        categoryName: categoryResult.categoryName,
        categoryCreated: categoryResult.created === true,
        provider: null,
      };
    }

    const providerSyncResult = syncProviderApprovalState_(
      requestResult.providerId,
      requestResult.phone,
      { markVerifiedApproved: true }
    );
    if (!providerSyncResult.ok) return providerSyncResult;

    return {
      ok: true,
      status: "success",
      requestId: requestId,
      categoryName: categoryResult.categoryName,
      categoryCreated: categoryResult.created === true,
      provider: {
        providerId: providerSyncResult.providerId,
        verified: providerSyncResult.verified,
        pendingApproval: providerSyncResult.pendingApproval,
        approvalStatus: providerSyncResult.approvalStatus,
        status: providerSyncResult.providerStatus,
        pendingCategories: providerSyncResult.pendingCategories,
      },
    };
  } finally {
    lock.releaseLock();
  }
}

function rejectCategoryRequest_(data) {
  const requestId = String(data.requestId || "").trim();
  const reason = String(data.reason || data.adminActionReason || "").trim();
  if (!requestId) return { ok: false, status: "error", error: "RequestID required" };
  if (!reason) return { ok: false, status: "error", error: "Reason required" };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const requestResult = updateCategoryApplicationStatus_(requestId, "rejected", {
      adminActionBy: resolveAdminActionActor_(data),
      adminActionAt: new Date(),
      adminActionReason: reason,
    });
    if (!requestResult.ok) return requestResult;

    if (typeof appendModerationLog_ === "function") {
      appendModerationLog_({
        ThreadID: "",
        MessageID: "",
        ActorType: "admin",
        ActorId: resolveAdminActionActor_(data),
        EventType: "category_request_rejected",
        Severity: "warning",
        Reason: reason,
        ActionTaken: "rejected",
        Metadata: JSON.stringify({
          requestId: requestId,
          providerId: requestResult.providerId || "",
          requestedCategory: requestResult.requestedCategory || "",
        }),
      });
    }

    // Skip provider sync for task-originated entries (no ProviderID)
    if (!requestResult.providerId) {
      return {
        ok: true,
        status: "success",
        requestId: requestId,
        provider: null,
      };
    }

    const providerSyncResult = syncProviderApprovalState_(
      requestResult.providerId,
      requestResult.phone,
      { markVerifiedApproved: false }
    );
    if (!providerSyncResult.ok) return providerSyncResult;

    return {
      ok: true,
      status: "success",
      requestId: requestId,
      provider: {
        providerId: providerSyncResult.providerId,
        verified: providerSyncResult.verified,
        pendingApproval: providerSyncResult.pendingApproval,
        approvalStatus: providerSyncResult.approvalStatus,
        status: providerSyncResult.providerStatus,
        pendingCategories: providerSyncResult.pendingCategories,
      },
    };
  } finally {
    lock.releaseLock();
  }
}

function updateCategoryRequestAdminAction_(data, nextStatus) {
  const requestId = String(data.requestId || data.RequestID || "").trim();
  const normalizedStatus = String(nextStatus || "").trim().toLowerCase();
  const reason = String(data.reason || data.adminActionReason || "").trim();
  if (!requestId) return { ok: false, status: "error", error: "RequestID required" };
  if (!normalizedStatus) return { ok: false, status: "error", error: "Status required" };
  if (!reason) return { ok: false, status: "error", error: "Reason required" };

  const allowedStatuses = {
    closed: true,
    archived: true,
    deleted_by_admin: true,
  };
  if (!allowedStatuses[normalizedStatus]) {
    return { ok: false, status: "error", error: "Unsupported status" };
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const actor = resolveAdminActionActor_(data);
    const requestResult = updateCategoryApplicationStatus_(requestId, normalizedStatus, {
      adminActionBy: actor,
      adminActionAt: new Date(),
      adminActionReason: reason,
    });
    if (!requestResult.ok) return requestResult;

    if (requestResult.providerId) {
      const providerSyncResult = syncProviderApprovalState_(requestResult.providerId, requestResult.phone, {});
      if (!providerSyncResult.ok) return providerSyncResult;
    }

    if (typeof appendModerationLog_ === "function") {
      appendModerationLog_({
        ThreadID: "",
        MessageID: "",
        ActorType: "admin",
        ActorId: actor,
        EventType: "category_request_" + normalizedStatus,
        Severity: normalizedStatus === "deleted_by_admin" ? "warning" : "info",
        Reason: reason,
        ActionTaken: normalizedStatus,
        Metadata: JSON.stringify({
          requestId: requestId,
          providerId: requestResult.providerId || "",
          requestedCategory: requestResult.requestedCategory || "",
        }),
      });
    }

    return {
      ok: true,
      status: "success",
      requestId: requestId,
      updatedStatus: normalizedStatus,
      providerId: requestResult.providerId || "",
    };
  } finally {
    lock.releaseLock();
  }
}

function setProviderVerified_(data) {
  const providerId = String(data.providerId || "").trim();
  const verified = String(data.verified || "").trim().toLowerCase();

  if (!providerId) return { ok: false, status: "error", error: "ProviderID required" };
  if (verified !== "yes" && verified !== "no") {
    return { ok: false, status: "error", error: "Verified must be yes or no" };
  }

  const providerState = getProviderSheetState_();
  const target = findProviderSheetRowState_(providerState, providerId, "");
  if (!target.ok) return target;
  const writeResult = writeProviderVerifiedValue_(providerState, target.rowNumber, verified);
  if (!writeResult.ok) return writeResult;
  if (verified === "yes") {
    const approvalWriteResult = writeProviderApprovalState_(providerState, target.rowNumber, {
      pendingApproval: "no",
      approvalStatus: "approved",
      status: "Active",
    });
    if (!approvalWriteResult.ok) return approvalWriteResult;
  }

  return {
    ok: true,
    status: "success",
    providerId: providerId,
    verified: verified,
  };
}

function getAdminProviders_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(TAB_PROVIDERS);
  if (!sh || sh.getLastRow() < 2) return [];

  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0] || [];
  const rows = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues();
  const headerMap = getProviderHeaderMap_(headers);
  const pendingLookup = buildPendingCategorySummaryLookup_();

  return rows
    .map((row) => {
      const providerId =
        headerMap.providerId !== -1 && row[headerMap.providerId] !== undefined
          ? String(row[headerMap.providerId]).trim()
          : "";
      const providerName =
        headerMap.providerName !== -1 && row[headerMap.providerName] !== undefined
          ? String(row[headerMap.providerName]).trim()
          : "";
      const phone =
        headerMap.phone !== -1 && row[headerMap.phone] !== undefined
          ? String(row[headerMap.phone]).trim()
          : "";
      const verified =
        headerMap.verified !== -1 && row[headerMap.verified] !== undefined
          ? String(row[headerMap.verified]).trim()
          : "no";
      const normalizedPhone = normalizePhone10_(phone);
      const hasPendingApproval = Boolean(
        (providerId && pendingLookup.byProviderId[providerId]) ||
          (normalizedPhone && pendingLookup.byPhone[normalizedPhone])
      );
      const category =
        headerMap.category !== -1 && row[headerMap.category] !== undefined
          ? String(row[headerMap.category]).trim()
          : "";
      const areas =
        headerMap.areas !== -1 && row[headerMap.areas] !== undefined
          ? String(row[headerMap.areas]).trim()
          : "";

      return {
        ProviderID: providerId,
        ProviderName: providerName,
        Phone: phone,
        Verified: verified || "no",
        PendingApproval: hasPendingApproval ? "yes" : "no",
        Category: category,
        Areas: areas,
      };
    })
    .filter((provider) => provider.ProviderID || provider.Phone || provider.ProviderName);
}

function countAdminDashboardVerifiedProviders_() {
  const providerState = getProviderSheetState_();
  const rows = Array.isArray(providerState && providerState.values)
    ? providerState.values.slice(1)
    : [];
  if (!providerState.sheet || rows.length === 0) return 0;

  return rows.filter(function (row) {
    return isProviderVerifiedBadgeGas_({
      Verified:
        providerState.headerMap.verified !== -1 &&
        row[providerState.headerMap.verified] !== undefined
          ? row[providerState.headerMap.verified]
          : "",
      OtpVerified:
        providerState.headerMap.otpVerified !== -1 &&
        row[providerState.headerMap.otpVerified] !== undefined
          ? row[providerState.headerMap.otpVerified]
          : "",
      OtpVerifiedAt:
        providerState.headerMap.otpVerifiedAt !== -1 &&
        row[providerState.headerMap.otpVerifiedAt] !== undefined
          ? row[providerState.headerMap.otpVerifiedAt]
          : "",
      PendingApproval:
        providerState.headerMap.pendingApproval !== -1 &&
        row[providerState.headerMap.pendingApproval] !== undefined
          ? row[providerState.headerMap.pendingApproval]
          : "",
    });
  }).length;
}

function getAdminDashboardStats_() {
  reconcileProviderApprovalStates_();
  const categoryApplications = getAdminCategoryApplications_();
  const providers = getAdminProviders_();
  const categories = getAdminCategories_();
  const areas = getAdminAreas_();
  const verifiedProviders = countAdminDashboardVerifiedProviders_();

  return {
    ok: true,
    stats: {
      totalProviders: providers.length,
      verifiedProviders: verifiedProviders,
      pendingAdminApprovals: providers.filter(
        (provider) => String(provider.PendingApproval).trim().toLowerCase() === "yes"
      ).length,
      pendingCategoryRequests: categoryApplications.filter(
        (item) => String(item.Status).trim().toLowerCase() === "pending"
      ).length,
    },
    providers: providers,
    categoryApplications: categoryApplications,
    categories: categories,
    areas: areas,
  };
}

function getProviderServices_(providerId) {
  if (!providerId) return [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TAB_PROVIDER_SERVICES);
  if (!sh) return [];

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 2) return [];

  const headersRaw = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const headers = headersRaw.map(h => String(h || "").trim().toLowerCase());

  const colPid =
    (headers.indexOf("providerid") !== -1 ? headers.indexOf("providerid") + 1 :
     headers.indexOf("provider_id") !== -1 ? headers.indexOf("provider_id") + 1 :
     headers.indexOf("provider id") !== -1 ? headers.indexOf("provider id") + 1 : 0);

  const colCat =
    (headers.indexOf("servicename") !== -1 ? headers.indexOf("servicename") + 1 :
     headers.indexOf("service") !== -1 ? headers.indexOf("service") + 1 :
     headers.indexOf("category") !== -1 ? headers.indexOf("category") + 1 :
     headers.indexOf("servicecategory") !== -1 ? headers.indexOf("servicecategory") + 1 :
     headers.indexOf("service category") !== -1 ? headers.indexOf("service category") + 1 : 0);

  if (!colPid || !colCat) {
    return [];
  }

  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const out = [];
  data.forEach(r => {
    const pid = String(r[colPid - 1] || "").trim();
    if (pid === String(providerId).trim()) {
      const cat = String(r[colCat - 1] || "").trim();
      if (cat) out.push({ Category: cat });
    }
  });
  return out;
}

function getProviderAreas_(providerId) {
  if (!providerId) return [];
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TAB_PROVIDER_AREAS);
  if (!sh) return [];

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 2) return [];

  const headersRaw = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const headers = headersRaw.map(h => String(h || "").trim().toLowerCase());

  const colPid =
    (headers.indexOf("providerid") !== -1 ? headers.indexOf("providerid") + 1 :
     headers.indexOf("provider_id") !== -1 ? headers.indexOf("provider_id") + 1 :
     headers.indexOf("provider id") !== -1 ? headers.indexOf("provider id") + 1 : 0);

  const colArea =
    (headers.indexOf("area") !== -1 ? headers.indexOf("area") + 1 :
     headers.indexOf("areaname") !== -1 ? headers.indexOf("areaname") + 1 :
     headers.indexOf("area name") !== -1 ? headers.indexOf("area name") + 1 : 0);

  if (!colPid || !colArea) {
    return [];
  }

  const data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
  const out = [];
  data.forEach(r => {
    const pid = String(r[colPid - 1] || "").trim();
    if (pid === String(providerId).trim()) {
      const area = String(r[colArea - 1] || "").trim();
      if (area) out.push({ Area: area });
    }
  });
  return out;
}

function getProviderAreaCoverageStatus_(providerId, activeAreas) {
  const normalizedProviderId = String(providerId || "").trim();
  const activeAreaList = Array.isArray(activeAreas) ? activeAreas : [];
  const activeAreaKeys = new Set(
    activeAreaList
      .map(function (item) {
        return getNormalizedAreaKey_(item && item.Area !== undefined ? item.Area : "");
      })
      .filter(Boolean)
  );
  const coverage = {
    ActiveApprovedAreas: activeAreaList
      .map(function (item) {
        const areaName = normalizeAreaName_(item && item.Area !== undefined ? item.Area : "");
        return areaName ? { Area: areaName, Status: "active" } : null;
      })
      .filter(Boolean),
    PendingAreaRequests: [],
    ResolvedOutcomes: [],
  };

  if (!normalizedProviderId || typeof getAreaReviewQueueState_ !== "function") {
    return coverage;
  }

  const state = getAreaReviewQueueState_();
  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const sourceType =
      state.idxSourceType !== -1 && row[state.idxSourceType] !== undefined
        ? String(row[state.idxSourceType]).trim()
        : "";
    const sourceRef =
      state.idxSourceRef !== -1 && row[state.idxSourceRef] !== undefined
        ? String(row[state.idxSourceRef]).trim()
        : "";
    if (sourceType !== "provider_area" || sourceRef !== normalizedProviderId) continue;

    const rawArea =
      state.idxRawArea !== -1 && row[state.idxRawArea] !== undefined
        ? normalizeAreaName_(row[state.idxRawArea])
        : "";
    const reviewStatus =
      state.idxStatus !== -1 && row[state.idxStatus] !== undefined
        ? String(row[state.idxStatus]).trim().toLowerCase()
        : "pending";
    const resolvedCanonicalArea =
      state.idxResolvedCanonicalArea !== -1 && row[state.idxResolvedCanonicalArea] !== undefined
        ? normalizeAreaName_(row[state.idxResolvedCanonicalArea])
        : "";
    const lastSeenAt =
      state.idxLastSeenAt !== -1 && row[state.idxLastSeenAt] !== undefined
        ? toIsoDateString_(row[state.idxLastSeenAt])
        : "";
    const resolvedAt =
      state.idxResolvedAt !== -1 && row[state.idxResolvedAt] !== undefined
        ? toIsoDateString_(row[state.idxResolvedAt])
        : "";

    if (!rawArea) continue;

    if (reviewStatus === "resolved") {
      const finalCanonicalArea = resolvedCanonicalArea || rawArea;
      const finalCanonicalKey = getNormalizedAreaKey_(finalCanonicalArea);
      coverage.ResolvedOutcomes.push({
        RequestedArea: rawArea,
        ResolvedCanonicalArea: finalCanonicalArea,
        CoverageActive: finalCanonicalKey ? activeAreaKeys.has(finalCanonicalKey) : false,
        Status:
          getNormalizedAreaKey_(rawArea) === getNormalizedAreaKey_(finalCanonicalArea)
            ? "approved"
            : "mapped",
        ResolvedAt: resolvedAt,
      });
      continue;
    }

    coverage.PendingAreaRequests.push({
      RequestedArea: rawArea,
      Status: "pending",
      LastSeenAt: lastSeenAt,
    });
  }

  coverage.PendingAreaRequests.sort(function (a, b) {
    return parseTaskDateMs_(String(b.LastSeenAt || "")) - parseTaskDateMs_(String(a.LastSeenAt || ""));
  });
  coverage.ResolvedOutcomes.sort(function (a, b) {
    return parseTaskDateMs_(String(b.ResolvedAt || "")) - parseTaskDateMs_(String(a.ResolvedAt || ""));
  });

  return coverage;
}

function getProviderTaskLookup_() {
  const state = getAdminTaskSheetState_();
  const byTaskId = {};
  const rows = [];

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const taskId =
      state.idxTaskId !== -1 && row[state.idxTaskId] !== undefined
        ? String(row[state.idxTaskId]).trim()
        : "";
    if (!taskId) continue;

    const item = {
      TaskID: taskId,
      DisplayID:
        state.idxDisplayId !== -1 && row[state.idxDisplayId] !== undefined
          ? String(row[state.idxDisplayId]).trim()
          : "",
      Category:
        state.idxCategory !== -1 && row[state.idxCategory] !== undefined
          ? String(row[state.idxCategory]).trim()
          : "",
      Area:
        state.idxArea !== -1 && row[state.idxArea] !== undefined
          ? String(row[state.idxArea]).trim()
          : "",
      Details:
        state.idxDetails !== -1 && row[state.idxDetails] !== undefined
          ? String(row[state.idxDetails]).trim()
          : "",
      Status:
        state.idxStatus !== -1 && row[state.idxStatus] !== undefined
          ? String(row[state.idxStatus]).trim()
          : "",
      CreatedAt:
        state.idxCreatedAt !== -1 && row[state.idxCreatedAt] !== undefined
          ? toIsoDateString_(row[state.idxCreatedAt])
          : "",
      AssignedProvider:
        state.idxAssignedProvider !== -1 && row[state.idxAssignedProvider] !== undefined
          ? String(row[state.idxAssignedProvider]).trim()
          : "",
      CompletedAt:
        state.idxCompletedAt !== -1 && row[state.idxCompletedAt] !== undefined
          ? toIsoDateString_(row[state.idxCompletedAt])
          : "",
    };

    byTaskId[taskId] = item;
    rows.push(item);
  }

  return { byTaskId: byTaskId, rows: rows };
}

function getProviderMatchRows_(providerId) {
  const normalizedProviderId = String(providerId || "").trim();
  const sheet = getProviderTaskMatchesSheet_();
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];

  const headers = values[0] || [];
  const idxTaskId = findHeaderIndexByAliases_(headers, ["TaskID"]);
  const idxProviderId = findHeaderIndexByAliases_(headers, ["ProviderID"]);
  const idxCategory = findHeaderIndexByAliases_(headers, ["Category"]);
  const idxArea = findHeaderIndexByAliases_(headers, ["Area"]);
  const idxStatus = findHeaderIndexByAliases_(headers, ["Status"]);
  const idxCreatedAt = findHeaderIndexByAliases_(headers, ["CreatedAt"]);
  const idxAcceptedAt = findHeaderIndexByAliases_(headers, ["AcceptedAt"]);

  return values
    .slice(1)
    .map(function (row) {
      return {
        TaskID:
          idxTaskId !== -1 && row[idxTaskId] !== undefined ? String(row[idxTaskId]).trim() : "",
        ProviderID:
          idxProviderId !== -1 && row[idxProviderId] !== undefined
            ? String(row[idxProviderId]).trim()
            : "",
        Category:
          idxCategory !== -1 && row[idxCategory] !== undefined
            ? String(row[idxCategory]).trim()
            : "",
        Area:
          idxArea !== -1 && row[idxArea] !== undefined ? String(row[idxArea]).trim() : "",
        Status:
          idxStatus !== -1 && row[idxStatus] !== undefined
            ? String(row[idxStatus]).trim().toLowerCase()
            : "",
        CreatedAt:
          idxCreatedAt !== -1 && row[idxCreatedAt] !== undefined
            ? toIsoDateString_(row[idxCreatedAt])
            : "",
        AcceptedAt:
          idxAcceptedAt !== -1 && row[idxAcceptedAt] !== undefined
            ? toIsoDateString_(row[idxAcceptedAt])
            : "",
      };
    })
    .filter(function (item) {
      return item.ProviderID === normalizedProviderId && item.TaskID;
    });
}

function getProviderServiceRequestThreadState_(taskId, providerId) {
  if (typeof getChatThreadStateByTaskProvider_ !== "function") return null;
  const result = getChatThreadStateByTaskProvider_(taskId, providerId);
  return result && result.thread ? result.thread : null;
}

function deriveProviderServiceRequestState_(task, matchRow, providerId, thread) {
  const normalizedProviderId = String(providerId || "").trim();
  const taskStatus = String(task && task.Status || "").trim().toLowerCase();
  const matchStatus = String(matchRow && matchRow.Status || "").trim().toLowerCase();
  const assignedProvider = String(task && task.AssignedProvider || "").trim();
  const completedAt = String(task && task.CompletedAt || "").trim();
  const threadStatus = String(thread && thread.Status || "").trim().toLowerCase();
  const providerResponded = Boolean(
    String(matchRow && matchRow.AcceptedAt || "").trim() ||
      matchStatus === "responded" ||
      matchStatus === "accepted"
  );
  const assignedToProvider = assignedProvider && assignedProvider === normalizedProviderId;
  const attendedByAnotherProvider = Boolean(
    assignedProvider && assignedProvider !== normalizedProviderId
  );
  const closed = Boolean(
    completedAt ||
      taskStatus === "completed" ||
      threadStatus === "closed"
  );

  if (attendedByAnotherProvider) {
    return {
      CurrentState: "attended_by_other_provider",
      Actionable: false,
      ProviderResponded: providerResponded,
      AttendedByAnotherProvider: true,
    };
  }

  if (closed) {
    return {
      CurrentState: assignedToProvider ? "closed" : "closed",
      Actionable: false,
      ProviderResponded: providerResponded,
      AttendedByAnotherProvider: false,
    };
  }

  if (taskStatus === "pending_approval") {
    return {
      CurrentState: "pending_approval",
      Actionable: false,
      ProviderResponded: providerResponded,
      AttendedByAnotherProvider: false,
    };
  }

  if (assignedToProvider) {
    return {
      CurrentState: "assigned_to_you",
      Actionable: true,
      ProviderResponded: true,
      AttendedByAnotherProvider: false,
    };
  }

  if (providerResponded) {
    return {
      CurrentState: "responded",
      Actionable: true,
      ProviderResponded: true,
      AttendedByAnotherProvider: false,
    };
  }

  return {
    CurrentState: "awaiting_response",
    Actionable: true,
    ProviderResponded: false,
    AttendedByAnotherProvider: false,
  };
}

function getProviderServiceRequests_(data) {
  if (typeof getProviderInbox_ === "function") {
    const fastRead = getProviderInbox_(data);
    if (fastRead && fastRead.ok === true && Number(fastRead.count || 0) > 0) {
      return {
        ok: true,
        status: "success",
        requests: Array.isArray(fastRead.requests) ? fastRead.requests : [],
      };
    }
  }

  const phone = normalizePhone10_(data.phone || data.ProviderPhone || data.providerPhone);
  if (!phone) return { ok: false, status: "error", error: "Invalid provider phone" };

  const providerRecord = getProviderRecordByPhone_(phone);
  if (!providerRecord || !providerRecord.ok || !providerRecord.provider || !providerRecord.provider.ProviderID) {
    return { ok: false, status: "error", error: "Provider not found" };
  }

  const providerId = String(providerRecord.provider.ProviderID || "").trim();
  const providerName = String(providerRecord.provider.ProviderName || "").trim();
  const taskLookup = getProviderTaskLookup_();
  const requests = getProviderMatchRows_(providerId)
    .map(function (matchRow) {
      const task = taskLookup.byTaskId[matchRow.TaskID] || {};
      if (!task || !String(task.TaskID || "").trim()) return null;

      const thread = getProviderServiceRequestThreadState_(matchRow.TaskID, providerId);
      const state = deriveProviderServiceRequestState_(task, matchRow, providerId, thread);

      return {
        TaskID: String(task.TaskID || "").trim(),
        DisplayID: String(task.DisplayID || "").trim(),
        Category: String(task.Category || matchRow.Category || "").trim(),
        Area: String(task.Area || matchRow.Area || "").trim(),
        Details: String(task.Details || "").trim(),
        CreatedAt: String(task.CreatedAt || "").trim(),
        SelectedTimeframe: String(task.SelectedTimeframe || "").trim(),
        ServiceDate: String(task.ServiceDate || "").trim(),
        TimeSlot: String(task.TimeSlot || "").trim(),
        TaskStatus: String(task.Status || "").trim(),
        MatchStatus: String(matchRow.Status || "").trim(),
        MatchCreatedAt: String(matchRow.CreatedAt || "").trim(),
        AcceptedAt: String(matchRow.AcceptedAt || "").trim(),
        AssignedProvider: String(task.AssignedProvider || "").trim(),
        CompletedAt: String(task.CompletedAt || "").trim(),
        ThreadID: String(thread && thread.ThreadID || "").trim(),
        ThreadStatus: String(thread && thread.Status || "").trim(),
        CurrentState: state.CurrentState,
        Actionable: state.Actionable,
        ProviderResponded: state.ProviderResponded,
        AttendedByAnotherProvider: state.AttendedByAnotherProvider,
      };
    })
    .filter(Boolean)
    .sort(function (a, b) {
      return parseTaskDateMs_(b.CreatedAt) - parseTaskDateMs_(a.CreatedAt);
    });

  return {
    ok: true,
    status: "success",
    provider: {
      ProviderID: providerId,
      ProviderName: providerName,
      Phone: phone,
    },
    requests: requests,
  };
}

function startOfTodayMs_() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
}

function buildCategoryDemandForRange_(taskRows, activeCategories, startMs) {
  const categoryLookup = {};
  const counts = {};
  const list = Array.isArray(activeCategories) ? activeCategories : [];

  list.forEach(function (categoryName) {
    const normalized = normalizeCategoryName_(categoryName);
    const key = getNormalizedCategoryKey_(normalized);
    if (!key || categoryLookup[key]) return;
    categoryLookup[key] = normalized;
  });

  (Array.isArray(taskRows) ? taskRows : []).forEach(function (task) {
    const createdAtMs = parseTaskDateMs_(task.CreatedAt);
    if (!createdAtMs || createdAtMs < startMs) return;

    const categoryKey = getNormalizedCategoryKey_(task.Category);
    if (!categoryLookup[categoryKey]) return;

    counts[categoryKey] = (counts[categoryKey] || 0) + 1;
  });

  return Object.keys(counts)
    .map(function (categoryKey) {
      return {
        CategoryName: categoryLookup[categoryKey],
        RequestCount: counts[categoryKey],
      };
    })
    .filter(function (item) {
      return Number(item.RequestCount || 0) > 0;
    })
    .sort(function (a, b) {
      if (b.RequestCount !== a.RequestCount) return b.RequestCount - a.RequestCount;
      return String(a.CategoryName || "").localeCompare(String(b.CategoryName || ""));
    });
}

function getProviderDashboardAnalytics_(providerId, services, areas) {
  const normalizedProviderId = String(providerId || "").trim();
  const serviceList = Array.isArray(services) ? services : [];
  const areaList = Array.isArray(areas) ? areas : [];
  const categories = serviceList
    .map(function (item) {
      return normalizeCategoryName_(item && item.Category !== undefined ? item.Category : "");
    })
    .filter(Boolean);
  const providerAreas = areaList
    .map(function (item) {
      return normalizeAreaName_(item && item.Area !== undefined ? item.Area : "");
    })
    .filter(Boolean);
  const categoryKeys = new Set(
    categories.map(function (item) {
      return getNormalizedCategoryKey_(item);
    })
  );

  const taskLookup = getProviderTaskLookup_();
  const taskRows = taskLookup.rows.filter(function (task) {
    return categoryKeys.has(getNormalizedCategoryKey_(task.Category));
  });
  const allPlatformTasks = Array.isArray(taskLookup.rows) ? taskLookup.rows : [];
  const areaDemandMap = {};
  taskRows.forEach(function (task) {
    const areaName = normalizeAreaName_(task.Area);
    if (!areaName) return;
    areaDemandMap[areaName] = (areaDemandMap[areaName] || 0) + 1;
  });

  const matchRows = getProviderMatchRows_(normalizedProviderId).filter(function (row) {
    if (!row.Category) return true;
    return categoryKeys.has(getNormalizedCategoryKey_(row.Category));
  });

  const matchedTaskIds = new Set();
  const respondedTaskIds = new Set();
  const acceptedTaskIds = new Set();

  matchRows.forEach(function (row) {
    matchedTaskIds.add(row.TaskID);
    if (row.Status === "responded" || row.AcceptedAt) {
      respondedTaskIds.add(row.TaskID);
    }
    if (row.AcceptedAt || row.Status === "accepted") {
      acceptedTaskIds.add(row.TaskID);
    }
  });

  const assignedTaskIds = new Set();
  const completedTaskIds = new Set();
  taskRows.forEach(function (task) {
    if (String(task.AssignedProvider || "").trim() === normalizedProviderId) {
      assignedTaskIds.add(task.TaskID);
      if (String(task.Status || "").trim().toLowerCase() === "completed" || task.CompletedAt) {
        completedTaskIds.add(task.TaskID);
      }
    }
  });

  assignedTaskIds.forEach(function (taskId) {
    acceptedTaskIds.add(taskId);
  });

  const totalRequestsMatchedToMe = matchedTaskIds.size;
  const totalRequestsRespondedByMe = respondedTaskIds.size;
  const totalRequestsAcceptedByMe = acceptedTaskIds.size;
  const totalRequestsCompletedByMe = completedTaskIds.size;
  const responseRate = totalRequestsMatchedToMe
    ? Math.round((totalRequestsRespondedByMe / totalRequestsMatchedToMe) * 100)
    : 0;
  const acceptanceRate = totalRequestsMatchedToMe
    ? Math.round((totalRequestsAcceptedByMe / totalRequestsMatchedToMe) * 100)
    : 0;

  const areaDemand = Object.keys(areaDemandMap)
    .map(function (areaName) {
      return {
        AreaName: areaName,
        RequestCount: areaDemandMap[areaName],
      };
    })
    .sort(function (a, b) {
      if (b.RequestCount !== a.RequestCount) return b.RequestCount - a.RequestCount;
      return String(a.AreaName || "").localeCompare(String(b.AreaName || ""));
    });

  const activeCategories = getAllCategoriesFromSheet_();
  const nowMs = Date.now();
  const categoryDemandByRange = {
    today: buildCategoryDemandForRange_(allPlatformTasks, activeCategories, startOfTodayMs_()),
    last7Days: buildCategoryDemandForRange_(allPlatformTasks, activeCategories, nowMs - 7 * 86400000),
    last30Days: buildCategoryDemandForRange_(
      allPlatformTasks,
      activeCategories,
      nowMs - 30 * 86400000
    ),
    last365Days: buildCategoryDemandForRange_(
      allPlatformTasks,
      activeCategories,
      nowMs - 365 * 86400000
    ),
  };

  const selectedAreaDemand = providerAreas
    .map(function (areaName) {
      return {
        AreaName: areaName,
        RequestCount: areaDemandMap[areaName] || 0,
        IsSelectedByProvider: true,
      };
    })
    .sort(function (a, b) {
      if (b.RequestCount !== a.RequestCount) return b.RequestCount - a.RequestCount;
      return String(a.AreaName || "").localeCompare(String(b.AreaName || ""));
    });

  // Build a set of TaskIDs where this provider has opened a chat thread.
  // Single sheet read — avoids per-task lookups.
  const chatEngagedTaskIds = new Set();
  try {
    const chatSheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_CHAT_THREADS);
    if (chatSheet) {
      const chatValues = chatSheet.getDataRange().getValues();
      if (chatValues.length > 1) {
        const chatHeader = chatValues[0].map(function (h) { return String(h || "").trim(); });
        const ciTaskId = chatHeader.indexOf("TaskID");
        const ciProviderId = chatHeader.indexOf("ProviderID");
        if (ciTaskId !== -1 && ciProviderId !== -1) {
          for (var ci = 1; ci < chatValues.length; ci++) {
            const chatRow = chatValues[ci];
            const chatTaskId = String(chatRow[ciTaskId] || "").trim();
            const chatProviderId = String(chatRow[ciProviderId] || "").trim();
            if (chatProviderId === normalizedProviderId && matchedTaskIds.has(chatTaskId)) {
              chatEngagedTaskIds.add(chatTaskId);
            }
          }
        }
      }
    }
  } catch (e) {
    // Non-blocking: if chat sheet read fails, fall back to matchRows-only Responded signal.
    Logger.log("getProviderDashboardAnalytics_: chat thread lookup failed: " + e);
  }

  const recentMatchedRequests = Array.from(matchedTaskIds)
    .map(function (taskId) {
      const task = taskLookup.byTaskId[taskId] || {};
      return {
        TaskID: taskId,
        DisplayID: task.DisplayID || "",
        Category: task.Category || "",
        Area: task.Area || "",
        Details: task.Details || "",
        CreatedAt: task.CreatedAt || "",
        Accepted: acceptedTaskIds.has(taskId),
        Responded: respondedTaskIds.has(taskId) || chatEngagedTaskIds.has(taskId),
      };
    })
    .sort(function (a, b) {
      return parseTaskDateMs_(b.CreatedAt) - parseTaskDateMs_(a.CreatedAt);
    })
    .slice(0, 6);

  return {
    Summary: {
      ProviderID: normalizedProviderId,
      Categories: categories,
      Areas: providerAreas,
    },
    Metrics: {
      TotalRequestsInMyCategories: taskRows.length,
      TotalRequestsMatchedToMe: totalRequestsMatchedToMe,
      TotalRequestsRespondedByMe: totalRequestsRespondedByMe,
      TotalRequestsAcceptedByMe: totalRequestsAcceptedByMe,
      TotalRequestsCompletedByMe: totalRequestsCompletedByMe,
      ResponseRate: responseRate,
      AcceptanceRate: acceptanceRate,
    },
    AreaDemand: areaDemand,
    SelectedAreaDemand: selectedAreaDemand,
    CategoryDemandByRange: categoryDemandByRange,
    RecentMatchedRequests: recentMatchedRequests,
  };
}

function getProviderLeads_(providerId) {
  return { ok: true, providerId: String(providerId || ""), leads: [] };
}

function debug_providerServices_headers_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TAB_PROVIDER_SERVICES);
  if (!sh) return { ok:false, error:"ProviderServices sheet not found", tab:TAB_PROVIDER_SERVICES };

  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0]
    .map(h => String(h||"").trim());

  return { ok:true, tab:TAB_PROVIDER_SERVICES, headers: headers };
}
