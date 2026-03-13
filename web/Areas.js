/*************************************************
 * AREAS
 *************************************************/
function getAreas_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_AREAS);
  if (!sh) return { ok: false, status: "error", error: "Areas sheet not found: " + SHEET_AREAS };

  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return { ok: true, status: "success", areas: [] };

  const out = [];
  const seen = new Set();

  for (let i = 1; i < values.length; i++) {
    const area = String(values[i][0] || "").trim().replace(/\s+/g, " ");
    const active = String(values[i][1] || "").trim().toLowerCase();

    if (!area) continue;
    if (active !== "yes") continue;

    const key = area.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(area);
  }

  out.sort((a, b) => a.localeCompare(b));
  return { ok: true, status: "success", areas: out };
}

function normalizeAreaName_(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getAreaSheetState_() {
  const sheet = getOrCreateSheet(SHEET_AREAS, ["AreaName", "Active"]);
  const headers = ensureSheetHeaders_(sheet, ["AreaName", "Active"]);
  const values = sheet.getDataRange().getValues();
  const idxName = findHeaderIndexByAliases_(headers, ["AreaName", "Area", "Name"]);
  const idxActive = findHeaderIndexByAliases_(headers, ["Active"]);

  return {
    sheet: sheet,
    headers: headers,
    values: values,
    idxName: idxName,
    idxActive: idxActive,
  };
}

function getAdminAreas_() {
  const state = getAreaSheetState_();
  const out = [];
  const seen = new Set();

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const areaName =
      state.idxName !== -1 && row[state.idxName] !== undefined
        ? normalizeAreaName_(row[state.idxName])
        : "";
    if (!areaName) continue;

    const key = areaName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      AreaName: areaName,
      Active:
        state.idxActive !== -1 && row[state.idxActive] !== undefined
          ? String(row[state.idxActive]).trim().toLowerCase() === "yes"
            ? "yes"
            : "no"
          : "yes",
    });
  }

  out.sort((a, b) => a.AreaName.localeCompare(b.AreaName));
  return out;
}

function addArea_(data) {
  const areaName = normalizeAreaName_(data.areaName);
  if (!areaName) {
    return { ok: false, status: "error", error: "AreaName required" };
  }

  const state = getAreaSheetState_();

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const existingName =
      state.idxName !== -1 && row[state.idxName] !== undefined
        ? normalizeAreaName_(row[state.idxName])
        : "";
    if (existingName.toLowerCase() === areaName.toLowerCase()) {
      return { ok: false, status: "error", error: "Area already exists" };
    }
  }

  state.sheet.appendRow(
    buildRowFromData_(state.headers, {
      AreaName: areaName,
      Active: "yes",
    })
  );

  return {
    ok: true,
    status: "success",
    area: {
      AreaName: areaName,
      Active: "yes",
    },
  };
}

function editArea_(data) {
  const oldArea = normalizeAreaName_(data.oldArea);
  const newArea = normalizeAreaName_(data.newArea);

  if (!oldArea || !newArea) {
    return { ok: false, status: "error", error: "OldArea and NewArea required" };
  }

  const state = getAreaSheetState_();
  let targetRow = -1;

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const existingName =
      state.idxName !== -1 && row[state.idxName] !== undefined
        ? normalizeAreaName_(row[state.idxName])
        : "";
    if (!existingName) continue;

    if (existingName.toLowerCase() === newArea.toLowerCase() && existingName.toLowerCase() !== oldArea.toLowerCase()) {
      return { ok: false, status: "error", error: "Area already exists" };
    }

    if (existingName.toLowerCase() === oldArea.toLowerCase()) {
      targetRow = i + 1;
    }
  }

  if (targetRow === -1) {
    return { ok: false, status: "error", error: "Area not found" };
  }

  const updates = { AreaName: newArea };
  if (findHeaderIndexByAliases_(state.headers, ["UpdatedAt"]) !== -1) {
    updates.UpdatedAt = new Date();
  }
  updateRowFromData_(state.sheet, targetRow, updates);

  return {
    ok: true,
    status: "success",
    area: {
      AreaName: newArea,
    },
  };
}
