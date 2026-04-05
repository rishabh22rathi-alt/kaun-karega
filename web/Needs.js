/*************************************************
 * NEEDS
 *************************************************/
const NEEDS_HEADERS_ = [
  "NeedID",
  "UserPhone",
  "DisplayName",
  "IsAnonymous",
  "Category",
  "Area",
  "Title",
  "Description",
  "Status",
  "ViewsCount",
  "ResponsesCount",
  "CreatedAt",
  "UpdatedAt",
  "ValidDays",
  "ExpiresAt",
  "CompletedAt",
  "ClosedAt",
  "ClosedBy",
  "AdminNote",
  "PriorityRank",
  "IsHidden",
];

function getNeedsSheet_() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sh = ss.getSheetByName(SHEET_NEEDS);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NEEDS);
  }
  ensureSheetHeaders_(sh, NEEDS_HEADERS_);
  return sh;
}

function getNeedsSheetState_() {
  var sh = getNeedsSheet_();
  var headers = ensureSheetHeaders_(sh, NEEDS_HEADERS_).map(function (header) {
    return String(header || "").trim();
  });
  var values = sh.getDataRange().getValues();

  return {
    sheet: sh,
    headers: headers,
    values: values,
    idxNeedId: headers.indexOf("NeedID"),
    idxUserPhone: headers.indexOf("UserPhone"),
    idxDisplayName: headers.indexOf("DisplayName"),
    idxIsAnonymous: headers.indexOf("IsAnonymous"),
    idxCategory: headers.indexOf("Category"),
    idxArea: headers.indexOf("Area"),
    idxTitle: headers.indexOf("Title"),
    idxDescription: headers.indexOf("Description"),
    idxStatus: headers.indexOf("Status"),
    idxViewsCount: headers.indexOf("ViewsCount"),
    idxResponsesCount: headers.indexOf("ResponsesCount"),
    idxCreatedAt: headers.indexOf("CreatedAt"),
    idxUpdatedAt: headers.indexOf("UpdatedAt"),
    idxValidDays: headers.indexOf("ValidDays"),
    idxExpiresAt: headers.indexOf("ExpiresAt"),
    idxCompletedAt: headers.indexOf("CompletedAt"),
    idxClosedAt: headers.indexOf("ClosedAt"),
    idxClosedBy: headers.indexOf("ClosedBy"),
    idxAdminNote: headers.indexOf("AdminNote"),
    idxPriorityRank: headers.indexOf("PriorityRank"),
    idxIsHidden: headers.indexOf("IsHidden"),
  };
}

function getNeedTimestamp_() {
  return Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
}

function normalizeNeedBoolean_(value) {
  if (typeof value === "boolean") return value;
  var normalized = String(value || "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function getNeedPosterLabel_(isAnonymous, displayName) {
  return isAnonymous ? "Anonymous" : String(displayName || "").trim();
}

function parseNeedCreatedAtMs_(value) {
  if (!value && value !== 0) return 0;
  if (Object.prototype.toString.call(value) === "[object Date]") {
    var dateMs = value.getTime();
    return isNaN(dateMs) ? 0 : dateMs;
  }

  var raw = String(value || "").trim();
  if (!raw) return 0;

  var match = raw.match(
    /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/
  );
  if (!match) return 0;

  var parsed = new Date(
    Number(match[3]),
    Number(match[2]) - 1,
    Number(match[1]),
    Number(match[4] || 0),
    Number(match[5] || 0),
    Number(match[6] || 0)
  );
  var parsedMs = parsed.getTime();
  return isNaN(parsedMs) ? 0 : parsedMs;
}

function normalizeNeedValidDays_(value) {
  var allowed = { 3: true, 7: true, 15: true, 30: true };
  var days = Number(value) || 0;
  return allowed[days] ? days : 3;
}

function addDaysToNeedTimestamp_(baseValue, validDays) {
  var baseMs = parseNeedCreatedAtMs_(baseValue);
  var safeDays = normalizeNeedValidDays_(validDays);
  if (!baseMs) return "";
  return Utilities.formatDate(
    new Date(baseMs + safeDays * 24 * 60 * 60 * 1000),
    "Asia/Kolkata",
    "dd/MM/yyyy HH:mm:ss"
  );
}

function normalizeNeedPriorityRank_(value) {
  if (value === "" || value === null || value === undefined) return 0;
  var rank = Number(value);
  return isNaN(rank) ? 0 : rank;
}

function getNeedCurrentStatus_(status, expiresAt, isHidden) {
  if (isHidden) return "hidden";

  var normalizedStatus = String(status || "").trim().toLowerCase();
  if (!normalizedStatus) normalizedStatus = "open";

  if (
    normalizedStatus === "open" &&
    parseNeedCreatedAtMs_(expiresAt) > 0 &&
    parseNeedCreatedAtMs_(expiresAt) <= Date.now()
  ) {
    return "expired";
  }

  return normalizedStatus;
}

function getNeedRowContext_(data) {
  var needId = String(data.NeedID || data.needId || "").trim();
  if (!needId) return { ok: false, status: "error", error: "NeedID required" };

  var state = getNeedsSheetState_();
  for (var i = 1; i < state.values.length; i++) {
    var row = state.values[i] || [];
    var rowNeedId =
      state.idxNeedId !== -1 && row[state.idxNeedId] !== undefined
        ? String(row[state.idxNeedId] || "").trim()
        : "";
    if (rowNeedId !== needId) continue;

    return {
      ok: true,
      state: state,
      row: row,
      rowNumber: i + 1,
      need: buildNeedFromRow_(state, row, i + 1),
    };
  }

  return { ok: false, status: "error", error: "Need not found" };
}

function setNeedCellIfPresent_(sheet, rowNumber, colIndex, value) {
  if (colIndex >= 0) {
    sheet.getRange(rowNumber, colIndex + 1).setValue(value);
  }
}

function getNextNeedId_() {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var currentSeq = Number(props.getProperty("NEED_ID_SEQ") || 0) || 0;

    if (!currentSeq) {
      var state = getNeedsSheetState_();
      for (var i = 1; i < state.values.length; i++) {
        var row = state.values[i] || [];
        var rawNeedId =
          state.idxNeedId !== -1 && row[state.idxNeedId] !== undefined
            ? String(row[state.idxNeedId] || "").trim()
            : "";
        var match = rawNeedId.match(/^ND-(\d+)$/i);
        if (!match) continue;
        var seq = Number(match[1]) || 0;
        if (seq > currentSeq) currentSeq = seq;
      }
    }

    currentSeq += 1;
    props.setProperty("NEED_ID_SEQ", String(currentSeq));
    return "ND-" + ("0000" + currentSeq).slice(-4);
  } finally {
    lock.releaseLock();
  }
}

function buildNeedFromRow_(state, row, rowNumber) {
  var displayName =
    state.idxDisplayName !== -1 && row[state.idxDisplayName] !== undefined
      ? String(row[state.idxDisplayName] || "").trim()
      : "";
  var isAnonymous =
    state.idxIsAnonymous !== -1 && row[state.idxIsAnonymous] !== undefined
      ? normalizeNeedBoolean_(row[state.idxIsAnonymous])
      : false;
  var createdAt =
    state.idxCreatedAt !== -1 && row[state.idxCreatedAt] !== undefined
      ? row[state.idxCreatedAt]
      : "";
  var expiresAt =
    state.idxExpiresAt !== -1 && row[state.idxExpiresAt] !== undefined
      ? row[state.idxExpiresAt]
      : "";
  var validDays =
    state.idxValidDays !== -1 && row[state.idxValidDays] !== undefined
      ? normalizeNeedValidDays_(row[state.idxValidDays])
      : 3;
  var isHidden =
    state.idxIsHidden !== -1 && row[state.idxIsHidden] !== undefined
      ? normalizeNeedBoolean_(row[state.idxIsHidden])
      : false;
  var currentStatus = getNeedCurrentStatus_(
    state.idxStatus !== -1 && row[state.idxStatus] !== undefined
      ? row[state.idxStatus]
      : "",
    expiresAt,
    isHidden
  );

  return {
    NeedID:
      state.idxNeedId !== -1 && row[state.idxNeedId] !== undefined
        ? String(row[state.idxNeedId] || "").trim()
        : "",
    UserPhone:
      state.idxUserPhone !== -1 && row[state.idxUserPhone] !== undefined
        ? String(row[state.idxUserPhone] || "").trim()
        : "",
    DisplayName:
      displayName,
    IsAnonymous:
      isAnonymous,
    PosterLabel: getNeedPosterLabel_(isAnonymous, displayName),
    Category:
      state.idxCategory !== -1 && row[state.idxCategory] !== undefined
        ? String(row[state.idxCategory] || "").trim()
        : "",
    Area:
      state.idxArea !== -1 && row[state.idxArea] !== undefined
        ? String(row[state.idxArea] || "").trim()
        : "",
    Title:
      state.idxTitle !== -1 && row[state.idxTitle] !== undefined
        ? String(row[state.idxTitle] || "").trim()
        : "",
    Description:
      state.idxDescription !== -1 && row[state.idxDescription] !== undefined
        ? String(row[state.idxDescription] || "").trim()
        : "",
    Status:
      state.idxStatus !== -1 && row[state.idxStatus] !== undefined
        ? String(row[state.idxStatus] || "").trim()
        : "",
    CurrentStatus: currentStatus,
    ViewsCount:
      state.idxViewsCount !== -1 && row[state.idxViewsCount] !== undefined
        ? Number(row[state.idxViewsCount]) || 0
        : 0,
    ResponsesCount:
      state.idxResponsesCount !== -1 && row[state.idxResponsesCount] !== undefined
        ? Number(row[state.idxResponsesCount]) || 0
        : 0,
    CreatedAt:
      String(createdAt || "").trim(),
    UpdatedAt:
      state.idxUpdatedAt !== -1 && row[state.idxUpdatedAt] !== undefined
        ? String(row[state.idxUpdatedAt] || "").trim()
        : "",
    ValidDays: validDays,
    ExpiresAt: String(expiresAt || "").trim(),
    CompletedAt:
      state.idxCompletedAt !== -1 && row[state.idxCompletedAt] !== undefined
        ? String(row[state.idxCompletedAt] || "").trim()
        : "",
    ClosedAt:
      state.idxClosedAt !== -1 && row[state.idxClosedAt] !== undefined
        ? String(row[state.idxClosedAt] || "").trim()
        : "",
    ClosedBy:
      state.idxClosedBy !== -1 && row[state.idxClosedBy] !== undefined
        ? String(row[state.idxClosedBy] || "").trim()
        : "",
    AdminNote:
      state.idxAdminNote !== -1 && row[state.idxAdminNote] !== undefined
        ? String(row[state.idxAdminNote] || "").trim()
        : "",
    PriorityRank:
      state.idxPriorityRank !== -1 && row[state.idxPriorityRank] !== undefined
        ? normalizeNeedPriorityRank_(row[state.idxPriorityRank])
        : 0,
    IsHidden: isHidden,
    _createdAtMs: parseNeedCreatedAtMs_(createdAt),
    _expiresAtMs: parseNeedCreatedAtMs_(expiresAt),
    _sortRowNumber: rowNumber,
  };
}

function createNeed_(data) {
  var phone = normalizePhone10_(data.UserPhone || data.userPhone || data.phone);
  var displayName = String(data.DisplayName || data.displayName || "").trim();
  var isAnonymousRaw =
    data.IsAnonymous !== undefined ? data.IsAnonymous : data.isAnonymous;
  var hasAnonymousChoice =
    isAnonymousRaw !== undefined && String(isAnonymousRaw || "").trim() !== "";
  var isAnonymous = normalizeNeedBoolean_(isAnonymousRaw);
  var category = String(data.Category || data.category || "").trim();
  var rawArea = String(data.Area || data.area || "").trim();
  var area = resolveCanonicalAreaName_(rawArea);
  var title = String(data.Title || data.title || "").trim();
  var description = String(data.Description || data.description || "").trim();
  var validDays = normalizeNeedValidDays_(
    data.ValidDays !== undefined ? data.ValidDays : data.validDays
  );

  if (!phone) return { ok: false, status: "error", error: "UserPhone required" };
  if (!hasAnonymousChoice) {
    return { ok: false, status: "error", error: "IsAnonymous required" };
  }
  if (!displayName && !isAnonymous) {
    return { ok: false, status: "error", error: "DisplayName required" };
  }
  if (!category) return { ok: false, status: "error", error: "Category required" };
  if (!area) return { ok: false, status: "error", error: "Area required" };
  if (!title) return { ok: false, status: "error", error: "Title required" };

  if (isAnonymous) {
    displayName = "";
  }

  var state = getNeedsSheetState_();
  var needId = getNextNeedId_();
  var now = getNeedTimestamp_();
  var expiresAt = addDaysToNeedTimestamp_(now, validDays);

  if (rawArea && !isKnownAreaName_(rawArea)) {
    queueAreaReviewItemSafe_(rawArea, {
      sourceType: "need",
      sourceRef: needId,
    });
  }

  var row = new Array(state.headers.length).fill("");

  if (state.idxNeedId >= 0) row[state.idxNeedId] = needId;
  if (state.idxUserPhone >= 0) row[state.idxUserPhone] = phone;
  if (state.idxDisplayName >= 0) row[state.idxDisplayName] = displayName;
  if (state.idxIsAnonymous >= 0) row[state.idxIsAnonymous] = isAnonymous;
  if (state.idxCategory >= 0) row[state.idxCategory] = category;
  if (state.idxArea >= 0) row[state.idxArea] = area;
  if (state.idxTitle >= 0) row[state.idxTitle] = title;
  if (state.idxDescription >= 0) row[state.idxDescription] = description;
  if (state.idxStatus >= 0) row[state.idxStatus] = "open";
  if (state.idxViewsCount >= 0) row[state.idxViewsCount] = 0;
  if (state.idxResponsesCount >= 0) row[state.idxResponsesCount] = 0;
  if (state.idxCreatedAt >= 0) row[state.idxCreatedAt] = now;
  if (state.idxUpdatedAt >= 0) row[state.idxUpdatedAt] = now;
  if (state.idxValidDays >= 0) row[state.idxValidDays] = validDays;
  if (state.idxExpiresAt >= 0) row[state.idxExpiresAt] = expiresAt;
  if (state.idxCompletedAt >= 0) row[state.idxCompletedAt] = "";
  if (state.idxClosedAt >= 0) row[state.idxClosedAt] = "";
  if (state.idxClosedBy >= 0) row[state.idxClosedBy] = "";
  if (state.idxAdminNote >= 0) row[state.idxAdminNote] = "";
  if (state.idxPriorityRank >= 0) row[state.idxPriorityRank] = 0;
  if (state.idxIsHidden >= 0) row[state.idxIsHidden] = false;

  state.sheet.appendRow(row);

  return {
    ok: true,
    status: "success",
    message: "Need created",
    NeedID: needId,
    ValidDays: validDays,
  };
}

function getNeeds_(data) {
  var state = getNeedsSheetState_();
  var categoryFilter = String(data.Category || data.category || "").trim().toLowerCase();
  var areaFilter = resolveCanonicalAreaName_(data.Area || data.area || "")
    .trim()
    .toLowerCase();
  var needs = [];

  for (var i = 1; i < state.values.length; i++) {
    var row = state.values[i] || [];
    var need = buildNeedFromRow_(state, row, i + 1);
    if (!need.NeedID) continue;
    if (need.IsHidden) continue;
    if (categoryFilter && String(need.Category || "").trim().toLowerCase() !== categoryFilter) {
      continue;
    }
    if (areaFilter && String(need.Area || "").trim().toLowerCase() !== areaFilter) {
      continue;
    }
    if (String(need.CurrentStatus || "").trim().toLowerCase() !== "open") continue;
    needs.push(need);
  }

  needs.sort(function (a, b) {
    if ((b._createdAtMs || 0) !== (a._createdAtMs || 0)) {
      return (b._createdAtMs || 0) - (a._createdAtMs || 0);
    }
    return (b._sortRowNumber || 0) - (a._sortRowNumber || 0);
  });

  return {
    ok: true,
    status: "success",
    count: needs.length,
    needs: needs.map(function (need) {
      delete need._createdAtMs;
      delete need._expiresAtMs;
      delete need._sortRowNumber;
      return need;
    }),
  };
}

function getMyNeeds_(data) {
  var phone = normalizePhone10_(data.UserPhone || data.userPhone || data.phone);
  if (!phone) return { ok: false, status: "error", error: "UserPhone required" };

  var state = getNeedsSheetState_();
  var needs = [];

  for (var i = 1; i < state.values.length; i++) {
    var row = state.values[i] || [];
    var need = buildNeedFromRow_(state, row, i + 1);
    if (need.UserPhone !== phone) continue;
    needs.push(need);
  }

  needs.sort(function (a, b) {
    if ((b._createdAtMs || 0) !== (a._createdAtMs || 0)) {
      return (b._createdAtMs || 0) - (a._createdAtMs || 0);
    }
    return (b._sortRowNumber || 0) - (a._sortRowNumber || 0);
  });

  return {
    ok: true,
    status: "success",
    count: needs.length,
    needs: needs.map(function (need) {
      delete need._createdAtMs;
      delete need._expiresAtMs;
      delete need._sortRowNumber;
      return need;
    }),
  };
}

function adminGetNeeds_(data) {
  var state = getNeedsSheetState_();
  var statusFilter = String(data.Status || data.status || "all").trim().toLowerCase();
  var categoryFilter = String(data.Category || data.category || "").trim().toLowerCase();
  var areaFilter = resolveCanonicalAreaName_(data.Area || data.area || "")
    .trim()
    .toLowerCase();
  var searchFilter = String(data.Search || data.search || "").trim().toLowerCase();
  var needs = [];

  for (var i = 1; i < state.values.length; i++) {
    var row = state.values[i] || [];
    var need = buildNeedFromRow_(state, row, i + 1);
    var derivedStatus = String(need.CurrentStatus || "").trim().toLowerCase();
    var matchesStatus = true;
    var searchHaystack = [
      String(need.NeedID || "").trim(),
      String(need.Title || "").trim(),
      String(need.Description || "").trim(),
      String(need.UserPhone || "").trim(),
      String(need.DisplayName || "").trim(),
    ]
      .join(" ")
      .toLowerCase();

    if (!need.NeedID) continue;

    if (statusFilter && statusFilter !== "all") {
      if (statusFilter === "hidden") {
        matchesStatus = Boolean(need.IsHidden);
      } else if (statusFilter === "active") {
        matchesStatus = !need.IsHidden && (derivedStatus === "open" || derivedStatus === "active");
      } else {
        matchesStatus = derivedStatus === statusFilter;
      }
    }

    if (!matchesStatus) continue;
    if (categoryFilter && String(need.Category || "").trim().toLowerCase() !== categoryFilter) {
      continue;
    }
    if (areaFilter && String(need.Area || "").trim().toLowerCase() !== areaFilter) {
      continue;
    }
    if (searchFilter && searchHaystack.indexOf(searchFilter) === -1) {
      continue;
    }

    needs.push(need);
  }

  needs.sort(function (a, b) {
    if ((b._createdAtMs || 0) !== (a._createdAtMs || 0)) {
      return (b._createdAtMs || 0) - (a._createdAtMs || 0);
    }
    return (b._sortRowNumber || 0) - (a._sortRowNumber || 0);
  });

  return {
    ok: true,
    status: "success",
    count: needs.length,
    needs: needs.map(function (need) {
      delete need._createdAtMs;
      delete need._expiresAtMs;
      delete need._sortRowNumber;
      return need;
    }),
  };
}

function markNeedComplete_(data) {
  var phone = normalizePhone10_(data.UserPhone || data.userPhone || data.phone);
  if (!phone) return { ok: false, status: "error", error: "UserPhone required" };

  var context = getNeedRowContext_(data);
  if (!context.ok) return context;
  if (String(context.need.UserPhone || "").trim() !== phone) {
    return { ok: false, status: "error", error: "Need ownership mismatch" };
  }

  var now = getNeedTimestamp_();
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxStatus, "completed");
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxCompletedAt, now);
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxUpdatedAt, now);

  return { ok: true, status: "success", NeedID: context.need.NeedID, message: "Need marked completed" };
}

function closeNeed_(data) {
  var phone = normalizePhone10_(data.UserPhone || data.userPhone || data.phone);
  if (!phone) return { ok: false, status: "error", error: "UserPhone required" };

  var context = getNeedRowContext_(data);
  if (!context.ok) return context;
  if (String(context.need.UserPhone || "").trim() !== phone) {
    return { ok: false, status: "error", error: "Need ownership mismatch" };
  }

  var now = getNeedTimestamp_();
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxStatus, "closed");
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxClosedAt, now);
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxClosedBy, "user");
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxUpdatedAt, now);

  return { ok: true, status: "success", NeedID: context.need.NeedID, message: "Need closed" };
}

function adminHideNeed_(data) {
  var context = getNeedRowContext_(data);
  if (!context.ok) return context;

  var now = getNeedTimestamp_();
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxIsHidden, true);
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxClosedBy, "admin");
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxUpdatedAt, now);

  return { ok: true, status: "success", NeedID: context.need.NeedID, message: "Need hidden" };
}

function adminUnhideNeed_(data) {
  var context = getNeedRowContext_(data);
  if (!context.ok) return context;

  var now = getNeedTimestamp_();
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxIsHidden, false);
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxUpdatedAt, now);

  return { ok: true, status: "success", NeedID: context.need.NeedID, message: "Need unhidden" };
}

function adminSetNeedRank_(data) {
  var context = getNeedRowContext_(data);
  if (!context.ok) return context;

  var now = getNeedTimestamp_();
  var nextRank = normalizeNeedPriorityRank_(
    data.PriorityRank !== undefined ? data.PriorityRank : data.priorityRank
  );
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxPriorityRank, nextRank);
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxUpdatedAt, now);

  return {
    ok: true,
    status: "success",
    NeedID: context.need.NeedID,
    PriorityRank: nextRank,
    message: "Need rank updated",
  };
}

function adminCloseNeed_(data) {
  var context = getNeedRowContext_(data);
  if (!context.ok) return context;

  var now = getNeedTimestamp_();
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxStatus, "closed");
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxClosedAt, now);
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxClosedBy, "admin");
  setNeedCellIfPresent_(context.state.sheet, context.rowNumber, context.state.idxUpdatedAt, now);

  return {
    ok: true,
    status: "success",
    NeedID: context.need.NeedID,
    message: "Need closed by admin",
  };
}
