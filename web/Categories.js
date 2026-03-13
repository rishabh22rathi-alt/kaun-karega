/*************************************************
 * CATEGORIES
 *************************************************/
function getAllCategoriesFromSheet_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_CATEGORIES);
  if (!sh) return [];

  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return [];

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

  const out = [];
  const seen = new Set();

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const name = normalizeCategoryName_(idxName >= 0 ? row[idxName] : row[1]);

    if (!name) continue;
    if (!isActiveCategoryRow_(row, idxStatus, idxActive)) continue;

    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    out.push(name);
  }

  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function getCategorySheetState_() {
  const sheet = getOrCreateSheet(SHEET_CATEGORIES, ["category_name", "active"]);
  const headers = ensureSheetHeaders_(sheet, ["category_name", "active"]);
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

  return {
    sheet: sheet,
    headers: headers,
    values: values,
    idxName: idxName,
    idxStatus: idxStatus,
    idxActive: idxActive,
  };
}

function getAdminCategories_() {
  const state = getCategorySheetState_();
  const out = [];
  const seen = new Set();

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const categoryName =
      state.idxName !== -1 && row[state.idxName] !== undefined
        ? normalizeCategoryName_(row[state.idxName])
        : "";
    if (!categoryName) continue;

    const key = categoryName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      CategoryName: categoryName,
      Active: isActiveCategoryRow_(row, state.idxStatus, state.idxActive) ? "yes" : "no",
    });
  }

  out.sort((a, b) => a.CategoryName.localeCompare(b.CategoryName));
  return out;
}

function addCategory_(data) {
  const categoryName = normalizeCategoryName_(data.categoryName);
  if (!categoryName) {
    return { ok: false, status: "error", error: "CategoryName required" };
  }

  const state = getCategorySheetState_();

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const existingName =
      state.idxName !== -1 && row[state.idxName] !== undefined
        ? normalizeCategoryName_(row[state.idxName])
        : "";
    if (existingName.toLowerCase() === categoryName.toLowerCase()) {
      return { ok: false, status: "error", error: "Category already exists" };
    }
  }

  const rowData = {
    category_name: categoryName,
    active: "yes",
  };
  if (state.idxStatus !== -1) rowData.Status = "approved";
  state.sheet.appendRow(buildRowFromData_(state.headers, rowData));

  return {
    ok: true,
    status: "success",
    category: {
      CategoryName: categoryName,
      Active: "yes",
    },
  };
}

function editCategory_(data) {
  const oldName = normalizeCategoryName_(data.oldName);
  const newName = normalizeCategoryName_(data.newName);

  if (!oldName || !newName) {
    return { ok: false, status: "error", error: "OldName and NewName required" };
  }

  const state = getCategorySheetState_();
  let targetRow = -1;

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const existingName =
      state.idxName !== -1 && row[state.idxName] !== undefined
        ? normalizeCategoryName_(row[state.idxName])
        : "";
    if (!existingName) continue;

    if (existingName.toLowerCase() === newName.toLowerCase() && existingName.toLowerCase() !== oldName.toLowerCase()) {
      return { ok: false, status: "error", error: "Category already exists" };
    }

    if (existingName.toLowerCase() === oldName.toLowerCase()) {
      targetRow = i + 1;
    }
  }

  if (targetRow === -1) {
    return { ok: false, status: "error", error: "Category not found" };
  }

  const updates = { category_name: newName };
  if (findHeaderIndexByAliases_(state.headers, ["UpdatedAt"]) !== -1) {
    updates.UpdatedAt = new Date();
  }
  updateRowFromData_(state.sheet, targetRow, updates);

  return {
    ok: true,
    status: "success",
    category: {
      CategoryName: newName,
    },
  };
}

function toggleCategory_(data) {
  const categoryName = normalizeCategoryName_(data.categoryName);
  const active = String(data.active || "").trim().toLowerCase();

  if (!categoryName) {
    return { ok: false, status: "error", error: "CategoryName required" };
  }
  if (active !== "yes" && active !== "no") {
    return { ok: false, status: "error", error: "Active must be yes or no" };
  }

  const state = getCategorySheetState_();

  for (let i = 1; i < state.values.length; i++) {
    const row = state.values[i] || [];
    const existingName =
      state.idxName !== -1 && row[state.idxName] !== undefined
        ? normalizeCategoryName_(row[state.idxName])
        : "";
    if (existingName.toLowerCase() !== categoryName.toLowerCase()) continue;

    const updates = { active: active };
    if (state.idxStatus !== -1) updates.Status = active === "yes" ? "approved" : "inactive";
    if (findHeaderIndexByAliases_(state.headers, ["UpdatedAt"]) !== -1) {
      updates.UpdatedAt = new Date();
    }
    updateRowFromData_(state.sheet, i + 1, updates);

    return {
      ok: true,
      status: "success",
      category: {
        CategoryName: existingName,
        Active: active,
      },
    };
  }

  return { ok: false, status: "error", error: "Category not found" };
}
