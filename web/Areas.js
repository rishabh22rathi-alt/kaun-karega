/*************************************************
 * AREAS
 *************************************************/
const SHEET_AREA_ALIASES = "AreaAliases";

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

function resolveCanonicalAreaName_(value) {
  const normalized = normalizeAreaName_(value);
  if (!normalized) return "";

  const key = getNormalizedAreaKey_(normalized);
  const canonicalAreas = getCanonicalAreasByKey_(true);
  if (canonicalAreas[key] && canonicalAreas[key].AreaName) {
    return canonicalAreas[key].AreaName;
  }

  const aliasLookup = getAreaAliasLookup_();
  if (aliasLookup[key]) {
    return aliasLookup[key];
  }

  return normalized;
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

function updateProviderAreaMappingsToCanonical_(sourceArea, canonicalArea) {
  const normalizedSourceArea = normalizeAreaName_(sourceArea);
  const normalizedCanonicalArea = normalizeAreaName_(canonicalArea);
  if (!normalizedSourceArea || !normalizedCanonicalArea) return;

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
}

function updateProviderAreaSummariesToCanonical_(sourceArea, canonicalArea) {
  const normalizedSourceArea = normalizeAreaName_(sourceArea);
  const normalizedCanonicalArea = normalizeAreaName_(canonicalArea);
  if (!normalizedSourceArea || !normalizedCanonicalArea) return;

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_PROVIDERS);
  if (!sheet || sheet.getLastRow() < 2) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] || [];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  const headerMap = getProviderHeaderMap_(headers);
  if (headerMap.areas === -1) return;

  const sourceKey = getNormalizedAreaKey_(normalizedSourceArea);
  const now = new Date();

  for (let i = 0; i < values.length; i++) {
    const areasRaw =
      headerMap.areas !== -1 && values[i][headerMap.areas] !== undefined
        ? String(values[i][headerMap.areas]).trim()
        : "";
    if (!areasRaw) continue;

    const normalizedAreas = uniqueNormalizedAreaValues_(areasRaw.split(",").map(function (value) {
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
  }
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
