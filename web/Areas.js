/*************************************************
 * AREAS
 *************************************************/
const SHEET_AREA_ALIASES = "AreaAliases";
const AREA_ALIAS_POST_UPDATE_SYNC_QUEUE_KEY = "AREA_ALIAS_POST_UPDATE_SYNC_QUEUE";
const AREA_ALIAS_POST_UPDATE_SYNC_TRIGGER_HANDLER = "processQueuedAreaAliasPostUpdateSync_";
const SHEET_AREA_REVIEW_QUEUE = "AreaReviewQueue";

function normalizeAreaName_(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getNormalizedAreaKey_(value) {
  return normalizeComparableKey_(normalizeAreaName_(value));
}

function isActiveAreaValue_(value) {
  if (value === undefined || value === null || String(value).trim() === "") return true;
  return isTruthySheetValue_(value);
}

function getAreaSheetState_() {
  const sheet = getOrCreateSheet(SHEET_AREAS, ["AreaName", "Active"]);
  const headers = ensureSheetHeaders_(sheet, ["AreaName", "Active"]);
  const values = sheet.getDataRange().getValues();
  const idxName = findHeaderIndexByAliases_(headers, ["AreaName", "Area", "Name"]);
  const idxActive = findHeaderIndexByAliases_(headers, ["Active"]);
  const idxUpdatedAt = findHeaderIndexByAliases_(headers, ["UpdatedAt"]);

  return {
    sheet: sheet,
    headers: headers,
    values: values,
    idxName: idxName,
    idxActive: idxActive,
    idxUpdatedAt: idxUpdatedAt,
  };
}

function getAreaAliasSheetState_() {
  const sheet = getOrCreateSheet(SHEET_AREA_ALIASES, [
    "AliasName",
    "CanonicalArea",
    "Active",
    "CreatedAt",
    "UpdatedAt",
  ]);
  const headers = ensureSheetHeaders_(sheet, [
    "AliasName",
    "CanonicalArea",
    "Active",
    "CreatedAt",
    "UpdatedAt",
  ]);
  const values = sheet.getDataRange().getValues();

  return {
    sheet: sheet,
    headers: headers,
    values: values,
    idxAliasName: findHeaderIndexByAliases_(headers, ["AliasName", "Alias", "AreaAlias"]),
    idxCanonicalArea: findHeaderIndexByAliases_(headers, [
      "CanonicalArea",
      "Canonical",
      "AreaName",
    ]),
    idxActive: findHeaderIndexByAliases_(headers, ["Active"]),
    idxCreatedAt: findHeaderIndexByAliases_(headers, ["CreatedAt", "Timestamp"]),
    idxUpdatedAt: findHeaderIndexByAliases_(headers, ["UpdatedAt"]),
  };
}

function getCanonicalAreasByKey_(includeInactive) {
  const state = getAreaSheetState_();
  const out = {};

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const areaName =
      state.idxName !== -1 && row[state.idxName] !== undefined
        ? normalizeAreaName_(row[state.idxName])
        : "";
    if (!areaName) continue;

    const isActive =
      state.idxActive !== -1 && row[state.idxActive] !== undefined
        ? isActiveAreaValue_(row[state.idxActive])
        : true;
    if (!includeInactive && !isActive) continue;

    const key = getNormalizedAreaKey_(areaName);
    if (!key || out[key]) continue;

    out[key] = {
      AreaName: areaName,
      Active: isActive ? "yes" : "no",
      RowNumber: i + 1,
    };
  }

  return out;
}

function getAreaAliasLookup_() {
  const aliasState = getAreaAliasSheetState_();
  const canonicalAreas = getCanonicalAreasByKey_(true);
  const out = {};

  for (let i = 1; i < aliasState.values.length; i++) {
    const row = aliasState.values[i] || [];
    const aliasName =
      aliasState.idxAliasName !== -1 && row[aliasState.idxAliasName] !== undefined
        ? normalizeAreaName_(row[aliasState.idxAliasName])
        : "";
    const canonicalArea =
      aliasState.idxCanonicalArea !== -1 && row[aliasState.idxCanonicalArea] !== undefined
        ? normalizeAreaName_(row[aliasState.idxCanonicalArea])
        : "";
    const active =
      aliasState.idxActive !== -1 && row[aliasState.idxActive] !== undefined
        ? isActiveAreaValue_(row[aliasState.idxActive])
        : true;

    if (!aliasName || !canonicalArea || !active) continue;

    const aliasKey = getNormalizedAreaKey_(aliasName);
    const canonicalKey = getNormalizedAreaKey_(canonicalArea);
    if (!aliasKey || !canonicalKey) continue;

    out[aliasKey] =
      canonicalAreas[canonicalKey] && canonicalAreas[canonicalKey].AreaName
        ? canonicalAreas[canonicalKey].AreaName
        : canonicalArea;
  }

  return out;
}

function getAreaResolution_(value) {
  const normalized = normalizeAreaName_(value);
  if (!normalized) {
    return {
      rawArea: "",
      resolvedArea: "",
      normalizedKey: "",
      matchedBy: "none",
      known: false,
    };
  }

  const key = getNormalizedAreaKey_(normalized);
  const activeCanonicalAreas = getCanonicalAreasByKey_(false);
  if (activeCanonicalAreas[key] && activeCanonicalAreas[key].AreaName) {
    return {
      rawArea: normalized,
      resolvedArea: activeCanonicalAreas[key].AreaName,
      normalizedKey: key,
      matchedBy: "canonical",
      known: true,
    };
  }

  const aliasLookup = getAreaAliasLookup_();
  if (aliasLookup[key]) {
    return {
      rawArea: normalized,
      resolvedArea: aliasLookup[key],
      normalizedKey: key,
      matchedBy: "alias",
      known: true,
    };
  }

  const canonicalAreas = getCanonicalAreasByKey_(true);
  if (canonicalAreas[key] && canonicalAreas[key].AreaName) {
    return {
      rawArea: normalized,
      resolvedArea: canonicalAreas[key].AreaName,
      normalizedKey: key,
      matchedBy: "canonical",
      known: true,
    };
  }

  return {
    rawArea: normalized,
    resolvedArea: normalized,
    normalizedKey: key,
    matchedBy: "none",
    known: false,
  };
}

function resolveCanonicalAreaName_(value) {
  return getAreaResolution_(value).resolvedArea;
}

function isKnownAreaName_(value) {
  return getAreaResolution_(value).known === true;
}

function getCanonicalAreaList_() {
  const byKey = getCanonicalAreasByKey_(false);
  return Object.keys(byKey)
    .map(function (key) {
      return byKey[key].AreaName;
    })
    .sort(function (a, b) {
      return String(a).localeCompare(String(b));
    });
}

function getAreas_() {
  return { ok: true, status: "success", areas: getCanonicalAreaList_() };
}

function getAdminAreas_() {
  const byKey = getCanonicalAreasByKey_(true);
  return Object.keys(byKey)
    .map(function (key) {
      return {
        AreaName: byKey[key].AreaName,
        Active: byKey[key].Active,
      };
    })
    .sort(function (a, b) {
      return String(a.AreaName || "").localeCompare(String(b.AreaName || ""));
     });
}

function getAreaReviewQueueState_() {
  const sheet = getOrCreateSheet(SHEET_AREA_REVIEW_QUEUE, [
    "ReviewID",
    "RawArea",
    "NormalizedKey",
    "Status",
    "Occurrences",
    "SourceType",
    "SourceRef",
    "FirstSeenAt",
    "LastSeenAt",
    "ResolvedCanonicalArea",
    "ResolvedAt",
  ]);
  const headers = ensureSheetHeaders_(sheet, [
    "ReviewID",
    "RawArea",
    "NormalizedKey",
    "Status",
    "Occurrences",
    "SourceType",
    "SourceRef",
    "FirstSeenAt",
    "LastSeenAt",
    "ResolvedCanonicalArea",
    "ResolvedAt",
  ]);
  const values = sheet.getDataRange().getValues();

  return {
    sheet: sheet,
    headers: headers,
    values: values,
    idxReviewId: findHeaderIndexByAliases_(headers, ["ReviewID"]),
    idxRawArea: findHeaderIndexByAliases_(headers, ["RawArea", "Area"]),
    idxNormalizedKey: findHeaderIndexByAliases_(headers, ["NormalizedKey"]),
    idxStatus: findHeaderIndexByAliases_(headers, ["Status"]),
    idxOccurrences: findHeaderIndexByAliases_(headers, ["Occurrences", "Count"]),
    idxSourceType: findHeaderIndexByAliases_(headers, ["SourceType"]),
    idxSourceRef: findHeaderIndexByAliases_(headers, ["SourceRef"]),
    idxFirstSeenAt: findHeaderIndexByAliases_(headers, ["FirstSeenAt", "CreatedAt"]),
    idxLastSeenAt: findHeaderIndexByAliases_(headers, ["LastSeenAt", "UpdatedAt"]),
    idxResolvedCanonicalArea: findHeaderIndexByAliases_(headers, [
      "ResolvedCanonicalArea",
      "CanonicalArea",
    ]),
    idxResolvedAt: findHeaderIndexByAliases_(headers, ["ResolvedAt"]),
  };
}

function makeAreaReviewId_() {
  return "ARQ-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000);
}

function queueAreaReviewItem_(rawArea, options) {
  const resolution = getAreaResolution_(rawArea);
  if (!resolution.rawArea || resolution.known) {
    return { ok: true, status: "success", queued: false };
  }

  const state = getAreaReviewQueueState_();
  const now = new Date();
  const normalizedKey = resolution.normalizedKey;
  const sourceType =
    options && options.sourceType !== undefined ? String(options.sourceType || "").trim() : "";
  const sourceRef =
    options && options.sourceRef !== undefined ? String(options.sourceRef || "").trim() : "";

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const rowKey =
      state.idxNormalizedKey !== -1 && row[state.idxNormalizedKey] !== undefined
        ? String(row[state.idxNormalizedKey]).trim()
        : "";
    const rowStatus =
      state.idxStatus !== -1 && row[state.idxStatus] !== undefined
        ? String(row[state.idxStatus]).trim().toLowerCase()
        : "pending";
    if (rowKey !== normalizedKey || rowStatus === "resolved") continue;

    const currentOccurrences =
      state.idxOccurrences !== -1 && row[state.idxOccurrences] !== undefined
        ? Number(row[state.idxOccurrences]) || 0
        : 0;
    const updates = {
      RawArea: resolution.rawArea,
      Status: "pending",
      Occurrences: currentOccurrences + 1,
      LastSeenAt: now,
    };
    if (sourceType) updates.SourceType = sourceType;
    if (sourceRef) updates.SourceRef = sourceRef;
    updateRowFromData_(state.sheet, i + 1, updates);
    return { ok: true, status: "success", queued: true };
  }

  state.sheet.appendRow(
    buildRowFromData_(state.headers, {
      ReviewID: makeAreaReviewId_(),
      RawArea: resolution.rawArea,
      NormalizedKey: normalizedKey,
      Status: "pending",
      Occurrences: 1,
      SourceType: sourceType,
      SourceRef: sourceRef,
      FirstSeenAt: now,
      LastSeenAt: now,
      ResolvedCanonicalArea: "",
      ResolvedAt: "",
    })
  );

  return { ok: true, status: "success", queued: true };
}

function queueAreaReviewItemSafe_(rawArea, options) {
  try {
    return queueAreaReviewItem_(rawArea, options);
  } catch (err) {
    Logger.log(
      "queueAreaReviewItemSafe_ failed | rawArea=%s | error=%s",
      String(rawArea || ""),
      String(err && err.message ? err.message : err)
    );
    return {
      ok: false,
      status: "error",
      queued: false,
      error: String(err && err.message ? err.message : err),
    };
  }
}

function getAdminAreaReviewQueue_() {
  const state = getAreaReviewQueueState_();
  const out = [];

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const status =
      state.idxStatus !== -1 && row[state.idxStatus] !== undefined
        ? String(row[state.idxStatus]).trim().toLowerCase()
        : "pending";
    if (status !== "pending") continue;

    out.push({
      ReviewID:
        state.idxReviewId !== -1 && row[state.idxReviewId] !== undefined
          ? String(row[state.idxReviewId]).trim()
          : "",
      RawArea:
        state.idxRawArea !== -1 && row[state.idxRawArea] !== undefined
          ? normalizeAreaName_(row[state.idxRawArea])
          : "",
      NormalizedKey:
        state.idxNormalizedKey !== -1 && row[state.idxNormalizedKey] !== undefined
          ? String(row[state.idxNormalizedKey]).trim()
          : "",
      Status: status || "pending",
      Occurrences:
        state.idxOccurrences !== -1 && row[state.idxOccurrences] !== undefined
          ? Number(row[state.idxOccurrences]) || 0
          : 0,
      SourceType:
        state.idxSourceType !== -1 && row[state.idxSourceType] !== undefined
          ? String(row[state.idxSourceType]).trim()
          : "",
      SourceRef:
        state.idxSourceRef !== -1 && row[state.idxSourceRef] !== undefined
          ? String(row[state.idxSourceRef]).trim()
          : "",
      FirstSeenAt:
        state.idxFirstSeenAt !== -1 && row[state.idxFirstSeenAt] !== undefined
          ? row[state.idxFirstSeenAt]
          : "",
      LastSeenAt:
        state.idxLastSeenAt !== -1 && row[state.idxLastSeenAt] !== undefined
          ? row[state.idxLastSeenAt]
          : "",
      ResolvedCanonicalArea:
        state.idxResolvedCanonicalArea !== -1 && row[state.idxResolvedCanonicalArea] !== undefined
          ? String(row[state.idxResolvedCanonicalArea]).trim()
          : "",
    });
  }

  return out.sort(function (a, b) {
    return new Date(String(b.LastSeenAt || "")).getTime() - new Date(String(a.LastSeenAt || "")).getTime();
  });
}

function markAreaReviewResolved_(reviewId, resolvedCanonicalArea) {
  const normalizedReviewId = String(reviewId || "").trim();
  if (!normalizedReviewId) {
    return { ok: false, status: "error", error: "ReviewID required" };
  }

  const state = getAreaReviewQueueState_();
  const now = new Date();
  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const rowReviewId =
      state.idxReviewId !== -1 && row[state.idxReviewId] !== undefined
        ? String(row[state.idxReviewId]).trim()
        : "";
    if (rowReviewId !== normalizedReviewId) continue;

    const updates = {
      Status: "resolved",
      ResolvedAt: now,
      LastSeenAt: now,
      ResolvedCanonicalArea: normalizeAreaName_(resolvedCanonicalArea || ""),
    };
    updateRowFromData_(state.sheet, i + 1, updates);
    return { ok: true, status: "success", reviewId: normalizedReviewId };
  }

  return { ok: false, status: "error", error: "Review item not found" };
}

function ensureCanonicalAreaExists_(areaName) {
  const normalizedAreaName = normalizeAreaName_(areaName);
  if (!normalizedAreaName) {
    return { ok: false, status: "error", error: "AreaName required" };
  }

  const state = getAreaSheetState_();
  const targetKey = getNormalizedAreaKey_(normalizedAreaName);

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const existingName =
      state.idxName !== -1 && row[state.idxName] !== undefined
        ? normalizeAreaName_(row[state.idxName])
        : "";
    if (getNormalizedAreaKey_(existingName) !== targetKey) continue;

    const updates = {};
    if (
      state.idxActive !== -1 &&
      row[state.idxActive] !== undefined &&
      !isActiveAreaValue_(row[state.idxActive])
    ) {
      updates.Active = "yes";
    }
    if (state.idxUpdatedAt !== -1) {
      updates.UpdatedAt = new Date();
    }
    if (Object.keys(updates).length) {
      updateRowFromData_(state.sheet, i + 1, updates);
    }

    return {
      ok: true,
      status: "success",
      area: {
        AreaName: existingName || normalizedAreaName,
        Active: "yes",
      },
    };
  }

  state.sheet.appendRow(
    buildRowFromData_(state.headers, {
      AreaName: normalizedAreaName,
      Active: "yes",
      CreatedAt: new Date(),
      UpdatedAt: new Date(),
    })
  );

  return {
    ok: true,
    status: "success",
    area: {
      AreaName: normalizedAreaName,
      Active: "yes",
    },
  };
}

function setCanonicalAreaActiveState_(areaName, active) {
  const normalizedAreaName = normalizeAreaName_(areaName);
  const targetKey = getNormalizedAreaKey_(normalizedAreaName);
  const state = getAreaSheetState_();

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const existingName =
      state.idxName !== -1 && row[state.idxName] !== undefined
        ? normalizeAreaName_(row[state.idxName])
        : "";
    if (getNormalizedAreaKey_(existingName) !== targetKey) continue;

    const updates = { Active: active ? "yes" : "no" };
    if (state.idxUpdatedAt !== -1) {
      updates.UpdatedAt = new Date();
    }
    updateRowFromData_(state.sheet, i + 1, updates);
    return { ok: true, status: "success" };
  }

  return { ok: false, status: "error", error: "Area not found" };
}

function upsertAreaAliasRecord_(aliasName, canonicalArea, activateAlias) {
  const normalizedAliasName = normalizeAreaName_(aliasName);
  const normalizedCanonicalArea = normalizeAreaName_(canonicalArea);
  if (!normalizedAliasName) {
    return { ok: false, status: "error", error: "AliasName required" };
  }
  if (!normalizedCanonicalArea) {
    return { ok: false, status: "error", error: "CanonicalArea required" };
  }
  if (
    getNormalizedAreaKey_(normalizedAliasName) ===
    getNormalizedAreaKey_(normalizedCanonicalArea)
  ) {
    return { ok: false, status: "error", error: "Alias and canonical area cannot match" };
  }

  const ensureResult = ensureCanonicalAreaExists_(normalizedCanonicalArea);
  if (!ensureResult.ok) return ensureResult;

  const aliasState = getAreaAliasSheetState_();
  const aliasKey = getNormalizedAreaKey_(normalizedAliasName);
  const now = new Date();

  for (let i = 1; i < aliasState.values.length; i++) {
    const row = aliasState.values[i] || [];
    const existingAlias =
      aliasState.idxAliasName !== -1 && row[aliasState.idxAliasName] !== undefined
        ? normalizeAreaName_(row[aliasState.idxAliasName])
        : "";
    if (getNormalizedAreaKey_(existingAlias) !== aliasKey) continue;

    const updates = {
      AliasName: normalizedAliasName,
      CanonicalArea: ensureResult.area.AreaName,
      Active: activateAlias === false ? "no" : "yes",
    };
    if (aliasState.idxUpdatedAt !== -1) {
      updates.UpdatedAt = now;
    }
    updateRowFromData_(aliasState.sheet, i + 1, updates);

    return {
      ok: true,
      status: "success",
      alias: {
        AliasName: normalizedAliasName,
        CanonicalArea: ensureResult.area.AreaName,
        Active: activateAlias === false ? "no" : "yes",
      },
    };
  }

  aliasState.sheet.appendRow(
    buildRowFromData_(aliasState.headers, {
      AliasName: normalizedAliasName,
      CanonicalArea: ensureResult.area.AreaName,
      Active: activateAlias === false ? "no" : "yes",
      CreatedAt: now,
      UpdatedAt: now,
    })
  );

  return {
    ok: true,
    status: "success",
    alias: {
      AliasName: normalizedAliasName,
      CanonicalArea: ensureResult.area.AreaName,
      Active: activateAlias === false ? "no" : "yes",
    },
  };
}

function findAreaAliasRowState_(aliasName) {
  const normalizedAliasName = normalizeAreaName_(aliasName);
  const aliasKey = getNormalizedAreaKey_(normalizedAliasName);
  const aliasState = getAreaAliasSheetState_();
  if (!normalizedAliasName) {
    return { ok: false, status: "error", error: "AliasName required" };
  }

  for (let i = 1; i < aliasState.values.length; i++) {
    const row = aliasState.values[i] || [];
    const existingAlias =
      aliasState.idxAliasName !== -1 && row[aliasState.idxAliasName] !== undefined
        ? normalizeAreaName_(row[aliasState.idxAliasName])
        : "";
    if (getNormalizedAreaKey_(existingAlias) !== aliasKey) continue;

    return {
      ok: true,
      aliasState: aliasState,
      rowNumber: i + 1,
      aliasName: existingAlias,
      canonicalArea:
        aliasState.idxCanonicalArea !== -1 && row[aliasState.idxCanonicalArea] !== undefined
          ? normalizeAreaName_(row[aliasState.idxCanonicalArea])
          : "",
      active:
        aliasState.idxActive !== -1 && row[aliasState.idxActive] !== undefined
          ? isActiveAreaValue_(row[aliasState.idxActive])
          : true,
    };
  }

  return { ok: false, status: "error", error: "Alias not found" };
}

function updateProviderAreaMappingsToCanonical_(sourceArea, canonicalArea) {
  const startedAt = Date.now();
  const normalizedSourceArea = normalizeAreaName_(sourceArea);
  const normalizedCanonicalArea = normalizeAreaName_(canonicalArea);
  if (!normalizedSourceArea || !normalizedCanonicalArea) {
    console.log(
      "[updateProviderAreaMappingsToCanonical_] end elapsedMs=" +
        (Date.now() - startedAt) +
        " skipped=true reason=missing-area"
    );
    return;
  }

  const sheet = getOrCreateSheet(SHEET_PROVIDER_AREAS, [
    "ProviderID",
    "AreaName",
    "IsActive",
    "Source",
    "CreatedAt",
    "UpdatedAt",
  ]);
  const headers = ensureSheetHeaders_(sheet, [
    "ProviderID",
    "AreaName",
    "IsActive",
    "Source",
    "CreatedAt",
    "UpdatedAt",
  ]);
  const values = sheet.getDataRange().getValues();
  const idxProviderId = findHeaderIndexByAliases_(headers, ["ProviderID"]);
  const idxAreaName = findHeaderIndexByAliases_(headers, ["AreaName", "Area"]);
  const idxIsActive = findHeaderIndexByAliases_(headers, ["IsActive", "Active"]);
  const idxUpdatedAt = findHeaderIndexByAliases_(headers, ["UpdatedAt"]);
  const sourceKey = getNormalizedAreaKey_(normalizedSourceArea);
  const canonicalKey = getNormalizedAreaKey_(normalizedCanonicalArea);
  const seen = new Set();
  const rowsToDelete = [];
  const now = new Date();
  let updatedRows = 0;

  console.log(
    "[updateProviderAreaMappingsToCanonical_] start sourceArea=" +
      normalizedSourceArea +
      " canonicalArea=" +
      normalizedCanonicalArea +
      " totalRows=" +
      Math.max(0, values.length - 1)
  );

  for (let i = 1; i < values.length; i++) {
    const row = values[i] || [];
    const providerId =
      idxProviderId !== -1 && row[idxProviderId] !== undefined
        ? String(row[idxProviderId]).trim()
        : "";
    let areaName =
      idxAreaName !== -1 && row[idxAreaName] !== undefined
        ? normalizeAreaName_(row[idxAreaName])
        : "";
    if (!providerId || !areaName) continue;

    if (getNormalizedAreaKey_(areaName) === sourceKey) {
      const updates = { AreaName: normalizedCanonicalArea };
      if (idxIsActive !== -1) updates.IsActive = "yes";
      if (idxUpdatedAt !== -1) updates.UpdatedAt = now;
      updateRowFromData_(sheet, i + 1, updates);
      updatedRows++;
      areaName = normalizedCanonicalArea;
    }

    const dedupeKey = providerId + "|" + getNormalizedAreaKey_(areaName);
    if (getNormalizedAreaKey_(areaName) === canonicalKey && seen.has(dedupeKey)) {
      rowsToDelete.push(i + 1);
      continue;
    }

    seen.add(dedupeKey);
  }

  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    sheet.deleteRow(rowsToDelete[i]);
  }

  console.log(
    "[updateProviderAreaMappingsToCanonical_] end elapsedMs=" +
      (Date.now() - startedAt) +
      " scannedRows=" +
      Math.max(0, values.length - 1) +
      " updatedRows=" +
      updatedRows +
      " deletedRows=" +
      rowsToDelete.length
  );
}

function updateProviderAreaSummariesToCanonical_(sourceArea, canonicalArea) {
  const startedAt = Date.now();
  const normalizedSourceArea = normalizeAreaName_(sourceArea);
  const normalizedCanonicalArea = normalizeAreaName_(canonicalArea);
  if (!normalizedSourceArea || !normalizedCanonicalArea) {
    console.log(
      "[updateProviderAreaSummariesToCanonical_] end elapsedMs=" +
        (Date.now() - startedAt) +
        " skipped=true reason=missing-area"
    );
    return;
  }

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PROVIDERS);
  if (!sheet || sheet.getLastRow() < 2) {
    console.log(
      "[updateProviderAreaSummariesToCanonical_] end elapsedMs=" +
        (Date.now() - startedAt) +
        " skipped=true reason=no-provider-rows"
    );
    return;
  }

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const headerMap = getProviderHeaderMap_(headers);
  if (headerMap.areas === -1) {
    console.log(
      "[updateProviderAreaSummariesToCanonical_] end elapsedMs=" +
        (Date.now() - startedAt) +
        " skipped=true reason=missing-areas-column"
    );
    return;
  }

  const sourceKey = getNormalizedAreaKey_(normalizedSourceArea);
  const now = new Date();
  let matchedRows = 0;
  let updatedRows = 0;

  console.log(
    "[updateProviderAreaSummariesToCanonical_] start sourceArea=" +
      normalizedSourceArea +
      " canonicalArea=" +
      normalizedCanonicalArea +
      " totalRows=" +
      values.length
  );

  for (let i = 0; i < values.length; i++) {
    const areasRaw =
      headerMap.areas !== -1 && values[i][headerMap.areas] !== undefined
        ? String(values[i][headerMap.areas]).trim()
        : "";
    if (!areasRaw) continue;

    const rawParts = areasRaw.split(",");
    const hasSourceRaw = rawParts.some(function (v) {
      return getNormalizedAreaKey_(normalizeAreaName_(v)) === sourceKey;
    });
    if (!hasSourceRaw) continue;
    matchedRows++;

    const normalizedAreas = uniqueNormalizedAreaValues_(rawParts.map(function (value) {
      const areaName = normalizeAreaName_(value);
      return getNormalizedAreaKey_(areaName) === sourceKey ? normalizedCanonicalArea : areaName;
    }));
    const hasSource = normalizedAreas.some(function (value) {
      return getNormalizedAreaKey_(value) === sourceKey;
    });
    const hasCanonical = normalizedAreas.some(function (value) {
      return getNormalizedAreaKey_(value) === getNormalizedAreaKey_(normalizedCanonicalArea);
    });
    if (!hasCanonical && !hasSource && areasRaw === normalizedAreas.join(", ")) continue;

    const updates = { Areas: normalizedAreas.join(", ") };
    if (headerMap.updatedAt !== -1) updates.UpdatedAt = now;
    updateRowFromData_(sheet, i + 2, updates);
    updatedRows++;
  }

  console.log(
    "[updateProviderAreaSummariesToCanonical_] end elapsedMs=" +
      (Date.now() - startedAt) +
      " scannedRows=" +
      values.length +
      " matchedRows=" +
      matchedRows +
      " updatedRows=" +
      updatedRows
  );
}

function uniqueNormalizedAreaValues_(values) {
  const out = [];
  const seen = new Set();

  (values || []).forEach(function (value) {
    const resolved = resolveCanonicalAreaName_(value);
    const normalized = normalizeAreaName_(resolved || value);
    const key = getNormalizedAreaKey_(normalized);
    if (!normalized || !key || seen.has(key)) return;
    seen.add(key);
    out.push(normalized);
  });

  return out;
}

function getAdminAreaMappings_() {
  const areas = getAdminAreas_();
  const aliasState = getAreaAliasSheetState_();
  const byCanonicalKey = {};

  areas.forEach(function (area) {
    const canonicalArea = normalizeAreaName_(area.AreaName);
    const key = getNormalizedAreaKey_(canonicalArea);
    if (!key) return;
    byCanonicalKey[key] = {
      CanonicalArea: canonicalArea,
      Active: String(area.Active || "yes").trim().toLowerCase() === "no" ? "no" : "yes",
      Aliases: [],
      AliasCount: 0,
    };
  });

  for (let i = 1; i < aliasState.values.length; i++) {
    const row = aliasState.values[i] || [];
    const aliasName =
      aliasState.idxAliasName !== -1 && row[aliasState.idxAliasName] !== undefined
        ? normalizeAreaName_(row[aliasState.idxAliasName])
        : "";
    const canonicalArea =
      aliasState.idxCanonicalArea !== -1 && row[aliasState.idxCanonicalArea] !== undefined
        ? resolveCanonicalAreaName_(row[aliasState.idxCanonicalArea])
        : "";
    const active =
      aliasState.idxActive !== -1 && row[aliasState.idxActive] !== undefined
        ? isActiveAreaValue_(row[aliasState.idxActive])
        : true;
    if (!aliasName || !canonicalArea) continue;

    const canonicalKey = getNormalizedAreaKey_(canonicalArea);
    if (!byCanonicalKey[canonicalKey]) {
      byCanonicalKey[canonicalKey] = {
        CanonicalArea: canonicalArea,
        Active: "yes",
        Aliases: [],
        AliasCount: 0,
      };
    }

    const aliasList = byCanonicalKey[canonicalKey].Aliases;
    const aliasKey = getNormalizedAreaKey_(aliasName);
    const exists = aliasList.some(function (item) {
      return getNormalizedAreaKey_(item.AliasName) === aliasKey;
    });
    if (exists) continue;

    aliasList.push({
      AliasName: aliasName,
      Active: active ? "yes" : "no",
    });
  }

  return Object.keys(byCanonicalKey)
    .map(function (key) {
      const item = byCanonicalKey[key];
      item.Aliases.sort(function (a, b) {
        return String(a.AliasName || "").localeCompare(String(b.AliasName || ""));
      });
      item.AliasCount = item.Aliases.filter(function (alias) {
        return String(alias.Active || "yes").trim().toLowerCase() === "yes";
      }).length;
      return item;
    })
    .sort(function (a, b) {
      return String(a.CanonicalArea || "").localeCompare(String(b.CanonicalArea || ""));
    });
}

function getAdminAreaMappingsResponse_() {
  return {
    ok: true,
    status: "success",
    mappings: getAdminAreaMappings_(),
  };
}

function addArea_(data) {
  return ensureCanonicalAreaExists_(data.areaName);
}

function editArea_(data) {
  const oldArea = normalizeAreaName_(data.oldArea);
  const newArea = normalizeAreaName_(data.newArea);

  if (!oldArea || !newArea) {
    return { ok: false, status: "error", error: "OldArea and NewArea required" };
  }

  const oldKey = getNormalizedAreaKey_(oldArea);
  const newKey = getNormalizedAreaKey_(newArea);
  const state = getAreaSheetState_();
  let targetRow = -1;

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const existingName =
      state.idxName !== -1 && row[state.idxName] !== undefined
        ? normalizeAreaName_(row[state.idxName])
        : "";
    const existingKey = getNormalizedAreaKey_(existingName);
    if (!existingKey) continue;

    if (existingKey === newKey && existingKey !== oldKey) {
      return { ok: false, status: "error", error: "Area already exists" };
    }

    if (existingKey === oldKey) {
      targetRow = i + 1;
    }
  }

  if (targetRow === -1) {
    return { ok: false, status: "error", error: "Area not found" };
  }

  const updates = { AreaName: newArea, Active: "yes" };
  if (state.idxUpdatedAt !== -1) {
    updates.UpdatedAt = new Date();
  }
  updateRowFromData_(state.sheet, targetRow, updates);

  const aliasState = getAreaAliasSheetState_();
  for (let i = 1; i < aliasState.values.length; i++) {
    const row = aliasState.values[i] || [];
    const canonicalArea =
      aliasState.idxCanonicalArea !== -1 && row[aliasState.idxCanonicalArea] !== undefined
        ? normalizeAreaName_(row[aliasState.idxCanonicalArea])
        : "";
    if (getNormalizedAreaKey_(canonicalArea) !== oldKey) continue;

    const aliasUpdates = { CanonicalArea: newArea };
    if (aliasState.idxUpdatedAt !== -1) {
      aliasUpdates.UpdatedAt = new Date();
    }
    updateRowFromData_(aliasState.sheet, i + 1, aliasUpdates);
  }

  updateProviderAreaMappingsToCanonical_(oldArea, newArea);
  updateProviderAreaSummariesToCanonical_(oldArea, newArea);

  return {
    ok: true,
    status: "success",
    area: {
      AreaName: newArea,
      Active: "yes",
    },
  };
}

function addAreaAlias_(data) {
  const aliasName = normalizeAreaName_(data.aliasName);
  const canonicalArea = normalizeAreaName_(data.canonicalArea);
  const result = upsertAreaAliasRecord_(aliasName, canonicalArea, true);
  if (!result.ok) return result;

  setCanonicalAreaActiveState_(aliasName, false);
  updateProviderAreaMappingsToCanonical_(aliasName, result.alias.CanonicalArea);
  updateProviderAreaSummariesToCanonical_(aliasName, result.alias.CanonicalArea);

  return {
    ok: true,
    status: "success",
    alias: result.alias,
  };
}

function enqueueAreaAliasPostUpdateSync_(sourceArea, canonicalArea) {
  const normalizedSourceArea = normalizeAreaName_(sourceArea);
  const normalizedCanonicalArea = normalizeAreaName_(canonicalArea);
  if (!normalizedSourceArea || !normalizedCanonicalArea) return;

  const props = PropertiesService.getScriptProperties();
  let queue = [];
  try {
    queue = JSON.parse(props.getProperty(AREA_ALIAS_POST_UPDATE_SYNC_QUEUE_KEY) || "[]");
    if (!Array.isArray(queue)) queue = [];
  } catch (e) {
    queue = [];
  }

  queue.push({
    sourceArea: normalizedSourceArea,
    canonicalArea: normalizedCanonicalArea,
    queuedAt: new Date().toISOString(),
  });
  props.setProperty(AREA_ALIAS_POST_UPDATE_SYNC_QUEUE_KEY, JSON.stringify(queue));

  const triggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === AREA_ALIAS_POST_UPDATE_SYNC_TRIGGER_HANDLER;
  });
  if (!triggers.length) {
    ScriptApp.newTrigger(AREA_ALIAS_POST_UPDATE_SYNC_TRIGGER_HANDLER).timeBased().after(1000).create();
    return;
  }
  for (let i = 1; i < triggers.length; i++) {
    ScriptApp.deleteTrigger(triggers[i]);
  }
}

function processQueuedAreaAliasPostUpdateSync_() {
  const props = PropertiesService.getScriptProperties();
  let queue = [];
  try {
    queue = JSON.parse(props.getProperty(AREA_ALIAS_POST_UPDATE_SYNC_QUEUE_KEY) || "[]");
    if (!Array.isArray(queue)) queue = [];
  } catch (e) {
    console.log("Alias post-update queue parse failed: " + e);
    queue = [];
  }

  const remaining = [];
  for (let i = 0; i < queue.length; i++) {
    const item = queue[i] || {};
    const sourceArea = normalizeAreaName_(item.sourceArea);
    const canonicalArea = normalizeAreaName_(item.canonicalArea);
    if (!sourceArea || !canonicalArea) {
      console.log("Alias post-update sync skipped malformed item: " + JSON.stringify(item));
      continue;
    }

    try {
      updateProviderAreaMappingsToCanonical_(sourceArea, canonicalArea);
      updateProviderAreaSummariesToCanonical_(sourceArea, canonicalArea);
      console.log(
        "Alias post-update sync completed for sourceArea=" +
          sourceArea +
          " canonicalArea=" +
          canonicalArea
      );
    } catch (e) {
      console.log(
        "Alias post-update sync failed for sourceArea=" +
          sourceArea +
          " canonicalArea=" +
          canonicalArea +
          " error=" +
          String(e && e.stack ? e.stack : e)
      );
      remaining.push(item);
    }
  }

  if (remaining.length) {
    props.setProperty(AREA_ALIAS_POST_UPDATE_SYNC_QUEUE_KEY, JSON.stringify(remaining));
  } else {
    props.deleteProperty(AREA_ALIAS_POST_UPDATE_SYNC_QUEUE_KEY);
  }

  const triggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === AREA_ALIAS_POST_UPDATE_SYNC_TRIGGER_HANDLER;
  });
  if (!remaining.length) {
    for (let i = 0; i < triggers.length; i++) {
      ScriptApp.deleteTrigger(triggers[i]);
    }
    return;
  }

  const nextTrigger = ScriptApp.newTrigger(AREA_ALIAS_POST_UPDATE_SYNC_TRIGGER_HANDLER)
    .timeBased()
    .after(1000)
    .create();
  const nextTriggerId = nextTrigger.getUniqueId();
  const refreshedTriggers = ScriptApp.getProjectTriggers().filter(function (trigger) {
    return trigger.getHandlerFunction() === AREA_ALIAS_POST_UPDATE_SYNC_TRIGGER_HANDLER;
  });
  for (let i = 0; i < refreshedTriggers.length; i++) {
    if (refreshedTriggers[i].getUniqueId() !== nextTriggerId) {
      ScriptApp.deleteTrigger(refreshedTriggers[i]);
    }
  }
}

function updateAreaAlias_(data) {
  const startedAt = Date.now();
  const oldAliasName = normalizeAreaName_(data.oldAliasName || data.aliasName);
  const newAliasName = normalizeAreaName_(data.newAliasName || oldAliasName);
  const canonicalArea = normalizeAreaName_(data.canonicalArea);
  console.log(
    "[updateAreaAlias_] start elapsedMs=0 oldAliasName=" +
      oldAliasName +
      " newAliasName=" +
      newAliasName +
      " canonicalArea=" +
      canonicalArea
  );
  if (!oldAliasName || !newAliasName || !canonicalArea) {
    return { ok: false, status: "error", error: "OldAliasName, NewAliasName, and CanonicalArea required" };
  }
  if (getNormalizedAreaKey_(newAliasName) === getNormalizedAreaKey_(canonicalArea)) {
    return { ok: false, status: "error", error: "Alias and canonical area cannot match" };
  }

  const target = findAreaAliasRowState_(oldAliasName);
  if (!target.ok) return target;

  const aliasState = target.aliasState;
  const oldKey = getNormalizedAreaKey_(oldAliasName);
  const newKey = getNormalizedAreaKey_(newAliasName);
  for (let i = 1; i < aliasState.values.length; i++) {
    if (i + 1 === target.rowNumber) continue;
    const row = aliasState.values[i] || [];
    const existingAlias =
      aliasState.idxAliasName !== -1 && row[aliasState.idxAliasName] !== undefined
        ? normalizeAreaName_(row[aliasState.idxAliasName])
        : "";
    if (getNormalizedAreaKey_(existingAlias) === newKey && newKey !== oldKey) {
      return { ok: false, status: "error", error: "Alias already exists" };
    }
  }

  const ensureResult = ensureCanonicalAreaExists_(canonicalArea);
  if (!ensureResult.ok) return ensureResult;
  const nextCanonicalArea = ensureResult.area.AreaName;
  const aliasChanged = getNormalizedAreaKey_(target.aliasName) !== getNormalizedAreaKey_(newAliasName);

  const updates = {
    AliasName: newAliasName,
    CanonicalArea: nextCanonicalArea,
    Active: target.active ? "yes" : "no",
    UpdatedAt: new Date(),
  };
  console.log(
    "[updateAreaAlias_] before updateRowFromData_ elapsedMs=" +
      (Date.now() - startedAt) +
      " rowNumber=" +
      target.rowNumber
  );
  updateRowFromData_(aliasState.sheet, target.rowNumber, updates);
  console.log(
    "[updateAreaAlias_] after updateRowFromData_ elapsedMs=" + (Date.now() - startedAt)
  );

  const response = {
    ok: true,
    status: "success",
    alias: {
      AliasName: newAliasName,
      CanonicalArea: nextCanonicalArea,
      Active: target.active ? "yes" : "no",
    },
  };

  if (aliasChanged) {
    enqueueAreaAliasPostUpdateSync_(target.aliasName, nextCanonicalArea);
    console.log(
      "[updateAreaAlias_] enqueued post-update sync elapsedMs=" +
        (Date.now() - startedAt) +
        " sourceArea=" +
        target.aliasName +
        " canonicalArea=" +
        nextCanonicalArea
    );
  }
  if (target.active && getCanonicalAreasByKey_(false)[getNormalizedAreaKey_(newAliasName)]) {
    setCanonicalAreaActiveState_(newAliasName, false);
  }

  console.log("[updateAreaAlias_] before return elapsedMs=" + (Date.now() - startedAt));
  return response;
}
function toggleAreaAlias_(data) {
  const aliasName = normalizeAreaName_(data.aliasName);
  const nextActive = String(data.active || "").trim().toLowerCase() === "yes";
  const target = findAreaAliasRowState_(aliasName);
  if (!target.ok) return target;

  const updates = {
    Active: nextActive ? "yes" : "no",
    UpdatedAt: new Date(),
  };
  updateRowFromData_(target.aliasState.sheet, target.rowNumber, updates);
  setCanonicalAreaActiveState_(aliasName, nextActive ? false : true);

  return {
    ok: true,
    status: "success",
    alias: {
      AliasName: target.aliasName,
      CanonicalArea: target.canonicalArea,
      Active: nextActive ? "yes" : "no",
    },
  };
}

function mergeAreaIntoCanonical_(data) {
  const sourceArea = normalizeAreaName_(data.sourceArea);
  const canonicalArea = normalizeAreaName_(data.canonicalArea);

  if (!sourceArea) {
    return { ok: false, status: "error", error: "SourceArea required" };
  }
  if (!canonicalArea) {
    return { ok: false, status: "error", error: "CanonicalArea required" };
  }
  if (getNormalizedAreaKey_(sourceArea) === getNormalizedAreaKey_(canonicalArea)) {
    return { ok: false, status: "error", error: "SourceArea and CanonicalArea cannot match" };
  }

  const aliasResult = addAreaAlias_({
    aliasName: sourceArea,
    canonicalArea: canonicalArea,
  });
  if (!aliasResult.ok) return aliasResult;

  return {
    ok: true,
    status: "success",
    sourceArea: sourceArea,
    canonicalArea: aliasResult.alias.CanonicalArea,
  };
}

function ensurePhase2LongFormAliasPreserved_(sourceArea, canonicalArea) {
  var longAreaName = normalizeAreaName_(sourceArea);
  var shortAreaName = normalizeAreaName_(canonicalArea);
  if (!longAreaName) {
    return { ok: false, status: "error", error: "SourceArea required" };
  }
  if (!shortAreaName) {
    return { ok: false, status: "error", error: "CanonicalArea required" };
  }
  if (!/\s+jodhpur$/i.test(longAreaName)) {
    return { ok: false, status: "error", error: "SourceArea must end with trailing Jodhpur" };
  }
  if (
    getNormalizedAreaKey_(normalizeAreaName_(longAreaName.replace(/\s+jodhpur$/i, ""))) !==
    getNormalizedAreaKey_(shortAreaName)
  ) {
    return { ok: false, status: "error", error: "SourceArea and CanonicalArea are not an exact Phase 2 pair" };
  }

  var aliasResult = upsertAreaAliasRecord_(longAreaName, shortAreaName, true);
  if (!aliasResult.ok) return aliasResult;

  var deactivateResult = setCanonicalAreaActiveState_(longAreaName, false);
  if (!deactivateResult.ok && String(deactivateResult.error || "") !== "Area not found") {
    return deactivateResult;
  }

  var aliasState = findAreaAliasRowState_(longAreaName);
  if (!aliasState.ok) {
    return { ok: false, status: "error", error: "Alias verification failed after upsert" };
  }
  if (!aliasState.active) {
    return { ok: false, status: "error", error: "Alias verification failed: alias inactive" };
  }
  if (getNormalizedAreaKey_(aliasState.canonicalArea) !== getNormalizedAreaKey_(aliasResult.alias.CanonicalArea)) {
    return { ok: false, status: "error", error: "Alias verification failed: canonical mismatch" };
  }

  return {
    ok: true,
    status: "success",
    alias: {
      AliasName: aliasState.aliasName,
      CanonicalArea: aliasState.canonicalArea,
      Active: aliasState.active ? "yes" : "no",
    },
  };
}

function getAdminUnmappedAreasResponse_() {
  return {
    ok: true,
    status: "success",
    reviews: getAdminAreaReviewQueue_(),
  };
}

function getPhase2AreaCanonicalDedupCandidates_() {
  var activeCanonicalsByKey = getCanonicalAreasByKey_(false);
  var activeCanonicalKeys = Object.keys(activeCanonicalsByKey).sort(function (a, b) {
    return String(activeCanonicalsByKey[a].AreaName || "").localeCompare(
      String(activeCanonicalsByKey[b].AreaName || "")
    );
  });
  var candidates = [];
  var skipped = [];

  for (var i = 0; i < activeCanonicalKeys.length; i++) {
    var longKey = activeCanonicalKeys[i];
    var longCanonical = activeCanonicalsByKey[longKey];
    var longAreaName = longCanonical && longCanonical.AreaName ? longCanonical.AreaName : "";
    if (!longAreaName || !/\s+jodhpur$/i.test(longAreaName)) continue;

    var shortAreaName = normalizeAreaName_(longAreaName.replace(/\s+jodhpur$/i, ""));
    var shortKey = getNormalizedAreaKey_(shortAreaName);
    if (!shortAreaName || !shortKey || shortKey === longKey) {
      skipped.push({
        sourceArea: longAreaName,
        canonicalArea: shortAreaName || "",
        reason: "invalid-short-name-after-trailing-jodhpur-removal",
      });
      continue;
    }

    var shortCanonical = activeCanonicalsByKey[shortKey];
    if (!shortCanonical || !shortCanonical.AreaName) {
      skipped.push({
        sourceArea: longAreaName,
        canonicalArea: shortAreaName,
        reason: "short-canonical-not-active",
      });
      continue;
    }

    var existingAlias = findAreaAliasRowState_(longAreaName);
    if (existingAlias.ok) {
      skipped.push({
        sourceArea: longAreaName,
        canonicalArea: shortCanonical.AreaName,
        reason: "long-name-already-exists-as-alias",
      });
      continue;
    }

    candidates.push({
      sourceArea: longAreaName,
      canonicalArea: shortCanonical.AreaName,
    });
  }

  return {
    candidates: candidates,
    skipped: skipped,
  };
}

function getPhase2AliasBackfillCandidates_() {
  var allCanonicalsByKey = getCanonicalAreasByKey_(true);
  var activeCanonicalsByKey = getCanonicalAreasByKey_(false);
  var canonicalKeys = Object.keys(allCanonicalsByKey).sort(function (a, b) {
    return String(allCanonicalsByKey[a].AreaName || "").localeCompare(
      String(allCanonicalsByKey[b].AreaName || "")
    );
  });
  var candidates = [];
  var skipped = [];

  for (var i = 0; i < canonicalKeys.length; i++) {
    var longKey = canonicalKeys[i];
    var longCanonical = allCanonicalsByKey[longKey];
    var longAreaName = longCanonical && longCanonical.AreaName ? longCanonical.AreaName : "";
    if (!longAreaName || !/\s+jodhpur$/i.test(longAreaName)) continue;

    var shortAreaName = normalizeAreaName_(longAreaName.replace(/\s+jodhpur$/i, ""));
    var shortKey = getNormalizedAreaKey_(shortAreaName);
    if (!shortAreaName || !shortKey || shortKey === longKey) {
      skipped.push({
        sourceArea: longAreaName,
        canonicalArea: shortAreaName || "",
        reason: "invalid-short-name-after-trailing-jodhpur-removal",
      });
      continue;
    }

    var shortCanonical = activeCanonicalsByKey[shortKey];
    if (!shortCanonical || !shortCanonical.AreaName) {
      skipped.push({
        sourceArea: longAreaName,
        canonicalArea: shortAreaName,
        reason: "short-canonical-not-active",
      });
      continue;
    }

    if (String(longCanonical.Active || "yes").trim().toLowerCase() === "yes") {
      skipped.push({
        sourceArea: longAreaName,
        canonicalArea: shortCanonical.AreaName,
        reason: "long-canonical-still-active",
      });
      continue;
    }

    var aliasState = findAreaAliasRowState_(longAreaName);
    if (
      aliasState.ok &&
      aliasState.active &&
      getNormalizedAreaKey_(aliasState.canonicalArea) === getNormalizedAreaKey_(shortCanonical.AreaName)
    ) {
      skipped.push({
        sourceArea: longAreaName,
        canonicalArea: shortCanonical.AreaName,
        reason: "active-alias-already-exists",
      });
      continue;
    }

    candidates.push({
      sourceArea: longAreaName,
      canonicalArea: shortCanonical.AreaName,
    });
  }

  return {
    candidates: candidates,
    skipped: skipped,
  };
}

/*
 * runPhase2AreaCanonicalDedup_
 *
 * Safe Phase 2 cleanup for exact duplicate canonical pairs only:
 *   X
 *   X Jodhpur
 *
 * Rules:
 *   - Both rows must currently exist as active canonicals
 *   - Only the trailing " Jodhpur" suffix may differ
 *   - The short name remains canonical
 *   - The long name becomes an alias to the short canonical
 *   - ProviderAreas + Providers summary rows are migrated via existing helpers
 *
 * Intentionally deferred:
 *   - Broad variant cluster consolidation
 *   - Ambiguous variants not matching the exact trailing suffix rule
 *   - Human-review items from Phase 1
 */
function runPhase2AreaCanonicalDedup_(dryRun, startIndex, limit) {
  var DRY_RUN = dryRun !== false;
  var batchStartIndex = Number(startIndex);
  var batchLimit = Number(limit);
  var log = [];
  var errors = [];
  var plan = getPhase2AreaCanonicalDedupCandidates_();
  var candidates = plan.candidates || [];
  var skipped = plan.skipped || [];
  var totalCandidates = candidates.length;
  if (!isFinite(batchStartIndex) || batchStartIndex < 0) batchStartIndex = 0;
  if (!isFinite(batchLimit) || batchLimit < 0) batchLimit = 10;
  var batchCandidates = candidates.slice(batchStartIndex, batchStartIndex + batchLimit);

  log.push("Phase 2 Area Canonical Dedup | DRY_RUN=" + DRY_RUN + " | " + new Date().toISOString());
  log.push("Rule: active canonical X + active canonical X Jodhpur -> keep X canonical, alias X Jodhpur");
  log.push("Total candidates=" + totalCandidates);
  log.push(
    "Batch range startIndex=" +
      batchStartIndex +
      " limit=" +
      batchLimit +
      " endIndexExclusive=" +
      (batchStartIndex + batchLimit)
  );

  for (var i = 0; i < skipped.length; i++) {
    var skippedPair = skipped[i];
    log.push(
      "[SKIP] \"" +
        skippedPair.sourceArea +
        "\" -> \"" +
        skippedPair.canonicalArea +
        "\" | reason=" +
        skippedPair.reason
    );
  }

  if (!totalCandidates) {
    log.push("[SKIP] no safe duplicate canonical pairs found");
  }

  for (var j = 0; j < batchCandidates.length; j++) {
    var pair = batchCandidates[j];
    if (DRY_RUN) {
      log.push("[DRY] \"" + pair.sourceArea + "\" -> \"" + pair.canonicalArea + "\"");
      continue;
    }

    try {
      var result = mergeAreaIntoCanonical_({
        sourceArea: pair.sourceArea,
        canonicalArea: pair.canonicalArea,
      });
      if (result.ok) {
        var preserveResult = ensurePhase2LongFormAliasPreserved_(pair.sourceArea, result.canonicalArea);
        if (!preserveResult.ok) {
          log.push(
            "[ERROR] alias preserve failed \"" +
              pair.sourceArea +
              "\" -> \"" +
              result.canonicalArea +
              "\" | error=" +
              (preserveResult.error || "unknown")
          );
          errors.push(
            "[ERROR] alias preserve failed \"" +
              pair.sourceArea +
              "\" -> \"" +
              result.canonicalArea +
              "\" | error=" +
              (preserveResult.error || "unknown")
          );
          continue;
        }
      }
      log.push(
        result.ok
          ? "[OK] merged \"" + pair.sourceArea + "\" -> \"" + result.canonicalArea + "\""
          : "[SKIP] merge failed \"" + pair.sourceArea + "\" -> \"" + pair.canonicalArea + "\" | reason=" + (result.error || "unknown")
      );
    } catch (e) {
      var errorMessage =
        "[ERROR] merge \"" +
        pair.sourceArea +
        "\" -> \"" +
        pair.canonicalArea +
        "\" | error=" +
        String(e && e.message ? e.message : e);
      log.push(errorMessage);
      errors.push(errorMessage);
    }
  }

  log.push(
    "Phase 2 done | candidates=" +
      totalCandidates +
      " | processed=" +
      batchCandidates.length +
      " | skipped=" +
      skipped.length +
      " | errors=" +
      errors.length
  );
  var summary = log.join("\n");
  console.log(summary);
  return summary;
}

function runPhase2AreaCanonicalDedup() {
  return runPhase2AreaCanonicalDedup_();
}

function runPhase2AliasBackfill_(dryRun) {
  var DRY_RUN = dryRun !== false;
  var log = [];
  var errors = [];
  var plan = getPhase2AliasBackfillCandidates_();
  var candidates = plan.candidates || [];
  var skipped = plan.skipped || [];

  log.push("Phase 2 Alias Backfill | DRY_RUN=" + DRY_RUN + " | " + new Date().toISOString());
  log.push("Rule: inactive canonical X Jodhpur + active canonical X + no active alias -> upsert active alias X Jodhpur -> X");

  for (var i = 0; i < skipped.length; i++) {
    var skippedPair = skipped[i];
    log.push(
      "[SKIP] \"" +
        skippedPair.sourceArea +
        "\" -> \"" +
        skippedPair.canonicalArea +
        "\" | reason=" +
        skippedPair.reason
    );
  }

  if (!candidates.length) {
    log.push("[SKIP] no Phase 2 alias backfill candidates found");
  }

  for (var j = 0; j < candidates.length; j++) {
    var pair = candidates[j];
    if (DRY_RUN) {
      log.push("[DRY] backfill alias \"" + pair.sourceArea + "\" -> \"" + pair.canonicalArea + "\"");
      continue;
    }

    try {
      var result = ensurePhase2LongFormAliasPreserved_(pair.sourceArea, pair.canonicalArea);
      log.push(
        result.ok
          ? "[OK] backfilled alias \"" + pair.sourceArea + "\" -> \"" + result.alias.CanonicalArea + "\""
          : "[SKIP] backfill failed \"" + pair.sourceArea + "\" -> \"" + pair.canonicalArea + "\" | reason=" + (result.error || "unknown")
      );
    } catch (e) {
      var errorMessage =
        "[ERROR] backfill \"" +
        pair.sourceArea +
        "\" -> \"" +
        pair.canonicalArea +
        "\" | error=" +
        String(e && e.message ? e.message : e);
      log.push(errorMessage);
      errors.push(errorMessage);
    }
  }

  log.push("Phase 2 Alias Backfill done | candidates=" + candidates.length + " | errors=" + errors.length);
  var summary = log.join("\n");
  console.log(summary);
  return summary;
}

function runPhase2AliasBackfill() {
  return runPhase2AliasBackfill_();
}

/*
 * runPhase1AreaCleanup_
 *
 * One-time maintenance function. Run from the GAS editor.
 *
 * Removes two classes of bad canonical areas:
 *   Group 1 — junk/test/generic/wrong-geography entries: deactivated only.
 *             No provider migration because no legitimate provider should be
 *             registered under "road", "gate", "Bhatinda", etc.
 *   Group 2 — typo canonicals that have a confirmed correct equivalent:
 *             merged via mergeAreaIntoCanonical_() which creates an alias
 *             (so old strings still resolve), deactivates the typo as a
 *             canonical, and migrates any ProviderAreas + Providers summary rows.
 *
 * Intentionally limited — Phase 2 items deferred:
 *   - <Name> / <Name> Jodhpur suffix deduplication (~35 pairs)
 *   - Kudi / Sangariya / Basni / Pal / Mahamandir / BJS / Boranada /
 *     Chopasni / Shikargarh variant cluster consolidation
 *   - AKHALIYA CIRCLE, indra nagar 3, sector c, DHINANA — skipped because
 *     no confirmed correct canonical equivalent exists yet
 *
 * Usage:
 *   1. Open GAS editor, run with DRY_RUN = true (default) and check logs.
 *   2. Set DRY_RUN = false, run again to execute.
 */
function runPhase1AreaCleanup_() {
  var DRY_RUN = true; // Set to false to execute — review dry-run logs first

  // Group 1: deactivate only (no alias, no provider migration)
  var DEACTIVATE_ONLY = [
    "test area 1",     // explicit test data
    "B",               // single-letter junk
    "rod",             // typo of "road", no legitimate area use
    "lane",            // generic English word, not a Jodhpur locality
    "road",            // generic word
    "gate",            // generic word — Jodhpur has specific named gates, not this
    "mandir",          // Hindi for "temple", not a locality
    "Scheme",          // planning generic
    "juni",            // informal Hindi ("old"), not a locality name
    "Mohallah",        // misspelled generic (Mohalla), not a specific area
    "cercle",          // typo of "circle", generic
    "Chouraha",        // Hindi for "crossroads" — generic; specific entries like Munjasar Chouraha exist
    "chouarha",        // typo variant of Chouraha
    "RAILWAY STATION", // landmark, not a residential/service area
    "Bhatinda",        // city in Punjab — wrong geography
    "Sri Ganganagar",  // city in northern Rajasthan — not Jodhpur
    "राजस्थान 342008", // Hindi state name + postal code — not an area
    "jodhour",         // typo of city name, no locality value
  ];

  // Group 2: merge typo-canonical → correct canonical
  // mergeAreaIntoCanonical_ handles: alias creation + canonical deactivation + provider migration
  // Only includes entries with a confirmed correct canonical in the live Areas sheet.
  // Skipped (no confirmed canonical): AKHALIYA CIRCLE, indra nagar 3, sector c, DHINANA
  var ALIAS_TO_CANONICAL = [
    { source: "badwasiya",         canonical: "Bhadwasiya" },
    { source: "Boranaada Jodhpur", canonical: "Boranada Jodhpur" },
    { source: "Shikargrah",        canonical: "Shikargarh" },
    { source: "SANGRIA",           canonical: "Sangariya" },
  ];

  var log = [];
  var errors = [];

  log.push("Phase 1 Area Cleanup | DRY_RUN=" + DRY_RUN + " | " + new Date().toISOString());

  for (var i = 0; i < DEACTIVATE_ONLY.length; i++) {
    var name = DEACTIVATE_ONLY[i];
    if (DRY_RUN) {
      log.push("[DRY] deactivate: \"" + name + "\"");
      continue;
    }
    try {
      var r = setCanonicalAreaActiveState_(name, false);
      log.push(r.ok
        ? "[OK] deactivated: \"" + name + "\""
        : "[SKIP] not found: \"" + name + "\" — " + (r.error || ""));
    } catch (e) {
      var msg = "[ERROR] deactivate \"" + name + "\": " + String(e && e.message ? e.message : e);
      log.push(msg);
      errors.push(msg);
    }
  }

  for (var j = 0; j < ALIAS_TO_CANONICAL.length; j++) {
    var pair = ALIAS_TO_CANONICAL[j];
    if (DRY_RUN) {
      log.push("[DRY] merge: \"" + pair.source + "\" → \"" + pair.canonical + "\"");
      continue;
    }
    try {
      var mr = mergeAreaIntoCanonical_({ sourceArea: pair.source, canonicalArea: pair.canonical });
      log.push(mr.ok
        ? "[OK] merged: \"" + pair.source + "\" → \"" + pair.canonical + "\""
        : "[SKIP] merge failed: \"" + pair.source + "\" — " + (mr.error || ""));
    } catch (e) {
      var merr = "[ERROR] merge \"" + pair.source + "\": " + String(e && e.message ? e.message : e);
      log.push(merr);
      errors.push(merr);
    }
  }

  log.push("Phase 1 done | errors=" + errors.length);
  var summary = log.join("\n");
  console.log(summary);
  return summary;
}

function mapUnmappedAreaReview_(data) {
  const reviewId = String(data.reviewId || "").trim();
  const rawArea = normalizeAreaName_(data.rawArea);
  const canonicalArea = normalizeAreaName_(data.canonicalArea);
  if (!reviewId || !rawArea || !canonicalArea) {
    return { ok: false, status: "error", error: "ReviewID, RawArea, and CanonicalArea required" };
  }

  const aliasResult = addAreaAlias_({
    aliasName: rawArea,
    canonicalArea: canonicalArea,
  });
  if (!aliasResult.ok) return aliasResult;

  const resolveResult = markAreaReviewResolved_(reviewId, aliasResult.alias.CanonicalArea);
  if (!resolveResult.ok) return resolveResult;

  return {
    ok: true,
    status: "success",
    reviewId: reviewId,
    alias: aliasResult.alias,
  };
}

function createAreaFromReview_(data) {
  const reviewId = String(data.reviewId || "").trim();
  const rawArea = normalizeAreaName_(data.rawArea);
  const canonicalArea = normalizeAreaName_(data.canonicalArea || rawArea);
  if (!reviewId || !rawArea || !canonicalArea) {
    return { ok: false, status: "error", error: "ReviewID and RawArea required" };
  }

  const areaResult = ensureCanonicalAreaExists_(canonicalArea);
  if (!areaResult.ok) return areaResult;

  if (getNormalizedAreaKey_(rawArea) !== getNormalizedAreaKey_(areaResult.area.AreaName)) {
    const aliasResult = addAreaAlias_({
      aliasName: rawArea,
      canonicalArea: areaResult.area.AreaName,
    });
    if (!aliasResult.ok) return aliasResult;
  }

  const resolveResult = markAreaReviewResolved_(reviewId, areaResult.area.AreaName);
  if (!resolveResult.ok) return resolveResult;

  return {
    ok: true,
    status: "success",
    reviewId: reviewId,
    area: areaResult.area,
  };
}

function resolveUnmappedAreaReview_(data) {
  return markAreaReviewResolved_(data.reviewId, data.resolvedCanonicalArea || "");
}
