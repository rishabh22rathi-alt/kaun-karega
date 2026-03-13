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

  const verified = String(
    provider.verified ||
    provider.Verified ||
    provider.providerVerified ||
    provider.isVerified ||
    ""
  ).trim().toLowerCase();

  return (
    verified === "yes" ||
    verified === "true" ||
    verified === "1" ||
    verified === "verified"
  ) ? 1 : 2;
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
  const providersSheet = ss.getSheetByName(SHEET_PROVIDERS);
  const servicesSheet  = ss.getSheetByName(SHEET_PROVIDER_SERVICES);
  const areasSheet     = ss.getSheetByName(SHEET_PROVIDER_AREAS);
  const categoriesSheet = ss.getSheetByName("Categories");

  if (!providersSheet || !servicesSheet || !areasSheet) {
    return { ok: false, status: "error", error: "Required sheets missing" };
  }

  const known = new Set();
  if (categoriesSheet && categoriesSheet.getLastRow() >= 2) {
    const lastCol = categoriesSheet.getLastColumn();
    const headers = categoriesSheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h||"").trim().toLowerCase());

    const colCat =
      (headers.indexOf("category") !== -1 ? headers.indexOf("category") + 1 :
       headers.indexOf("name") !== -1 ? headers.indexOf("name") + 1 :
       headers.indexOf("service") !== -1 ? headers.indexOf("service") + 1 : 1);

    const vals = categoriesSheet.getRange(2, colCat, categoriesSheet.getLastRow() - 1, 1).getValues();
    vals.forEach(r => {
      const v = String(r[0] || "").trim();
      if (v) known.add(v.toLowerCase());
    });
  }

  const cleanCats = categories.map(c => String(c || "").trim()).filter(Boolean);
  const unknownCats = cleanCats.filter(c => !known.has(c.toLowerCase()));
  const shouldAutoVerify = (unknownCats.length === 0);

  const now = new Date();

  const provData = providersSheet.getDataRange().getValues();
  let providerRow = -1;
  let providerId = "";
  let colPending = 0;

  const provHeaders = provData[0].map(h => String(h||"").trim().toLowerCase());
  colPending = provHeaders.indexOf("pendingcategories") + 1;

  if (!colPending) {
    colPending = provHeaders.length + 1;
    providersSheet.getRange(1, colPending).setValue("PendingCategories");
  }

  for (let i = 1; i < provData.length; i++) {
    if (String(provData[i][2] || "").trim() === phone) {
      providerRow = i + 1;
      providerId = String(provData[i][0] || "").trim();
      break;
    }
  }

  if (providerRow === -1) {
    providerId = nextProviderId_(providersSheet);
    providersSheet.appendRow([
      providerId,
      providerName,
      phone,
      "",
      "",
      shouldAutoVerify ? "yes" : "no",
      unknownCats.join(", ")
    ]);
  } else {
    providersSheet.getRange(providerRow, 2).setValue(providerName);
    providersSheet.getRange(providerRow, 6).setValue(shouldAutoVerify ? "yes" : "no");
    providersSheet.getRange(providerRow, colPending).setValue(unknownCats.join(", "));
  }

  deleteRowsByProvider_(servicesSheet, providerId);
  deleteRowsByProvider_(areasSheet, providerId);

  cleanCats.forEach((cat) => {
    servicesSheet.appendRow([providerId, cat, "yes", "self_registered", now, now]);
  });

  areas.forEach((aName) => {
    aName = String(aName || "").trim();
    if (!aName) return;
    areasSheet.appendRow([providerId, aName, "yes", "self_registered", now, now]);
  });

  return {
    ok: true,
    status: "success",
    providerId: providerId,
    autoVerified: shouldAutoVerify,
    pendingCategories: unknownCats
  };
}

/*************************************************
 * PROVIDERS (Profile / Leads)
 *************************************************/
function getProviderByPhone_(phoneRaw) {
  const phone10 = normalizeIndianMobile_(phoneRaw);
  if (!phone10) return { ok: false, error: "INVALID_PHONE" };

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(TAB_PROVIDERS);
  if (!sh) return { ok: false, error: "PROVIDERS_SHEET_NOT_FOUND", sheet: TAB_PROVIDERS };

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: "NO_PROVIDERS" };

  const map = headerMap_(sh);

  const colPhone = map["phone"] || map["providerphone"] || map["userphone"] || 0;
  const colId = map["providerid"] || map["id"] || 0;
  const colName = map["providername"] || map["name"] || map["provider"] || 0;
  const colVerified = map["verified"] || map["isverified"] || 0;

  if (!colPhone || !colId || !colName) {
    return {
      ok: false,
      error: "PROVIDERS_HEADERS_MISSING",
      debug: { colPhone: colPhone, colId: colId, colName: colName, colVerified: colVerified, headers: Object.keys(map) }
    };
  }

  const phones = sh.getRange(2, colPhone, lastRow - 1, 1).getValues();

  let foundRow = -1;
  for (let i = 0; i < phones.length; i++) {
    const rowPhone10 = normalizeIndianMobile_(phones[i][0]);
    if (rowPhone10 === phone10) {
      foundRow = i + 2;
      break;
    }
  }

  if (foundRow === -1) {
    return { ok: false, error: "PROVIDER_NOT_FOUND", phone: phone10 };
  }

  const providerId = String(sh.getRange(foundRow, colId).getValue() || "").trim();
  const providerName = String(sh.getRange(foundRow, colName).getValue() || "").trim();
  const verifiedRaw = colVerified ? String(sh.getRange(foundRow, colVerified).getValue() || "").trim() : "no";
  const verified = (verifiedRaw.toLowerCase() === "yes") ? "yes" : "no";

  const services = getProviderServices_(providerId);
  const areas = getProviderAreas_(providerId);

  return {
    ok: true,
    provider: {
      ProviderID: providerId,
      ProviderName: providerName,
      Phone: phone10,
      Verified: verified,
      Services: services,
      Areas: areas
    }
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
