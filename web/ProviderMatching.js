/*************************************************
 * PROVIDER MATCHING
 *************************************************/
function serviceStats_(serviceName) {
  serviceName = String(serviceName || "").trim();
  if (!serviceName) return { ok: false, status: "error", error: "Missing service" };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const shServices = ss.getSheetByName(SHEET_PROVIDER_SERVICES);
  if (!shServices) return { ok: false, status: "error", error: "Sheet not found: " + SHEET_PROVIDER_SERVICES };

  const values = shServices.getDataRange().getValues();
  if (values.length < 2) return { ok: true, status: "success", service: serviceName, total: 0 };

  const header = values[0].map(h => String(h).trim());
  const iService = header.indexOf("ServiceName");
  const iActive  = header.indexOf("IsActive");

  if (iService === -1 || iActive === -1) return { ok: false, status: "error", error: "ProviderServices headers invalid" };

  let total = 0;
  for (let r = 1; r < values.length; r++) {
    const s = String(values[r][iService] || "").trim();
    const a = String(values[r][iActive] || "").trim().toLowerCase();
    if (s === serviceName && a === "yes") total++;
  }

  return { ok: true, status: "success", service: serviceName, total: total };
}

function matchProviders_(serviceName, areaName, limit) {
  serviceName = String(serviceName || "").trim();
  areaName = String(areaName || "").trim();
  limit = Math.min(parseInt(limit || "20", 10) || 20, 50);

  if (!serviceName) return { ok: false, status: "error", error: "Missing service" };
  if (!areaName) return { ok: false, status: "error", error: "Missing area" };

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const shAreas = ss.getSheetByName(SHEET_PROVIDER_AREAS);
  const shServices = ss.getSheetByName(SHEET_PROVIDER_SERVICES);
  const shProviders = ss.getSheetByName(SHEET_PROVIDERS);

  if (!shAreas) return { ok: false, status: "error", error: "Sheet not found: " + SHEET_PROVIDER_AREAS };
  if (!shServices) return { ok: false, status: "error", error: "Sheet not found: " + SHEET_PROVIDER_SERVICES };
  if (!shProviders) return { ok: false, status: "error", error: "Sheet not found: " + SHEET_PROVIDERS };

  const services = shServices.getDataRange().getValues();
  if (services.length < 2) return { ok: true, status: "success", service: serviceName, area: areaName, count: 0, providers: [] };

  const sHeader = services[0].map(h => String(h).trim());
  const siPID = sHeader.indexOf("ProviderID");
  const siService = sHeader.indexOf("ServiceName");
  const siActive = sHeader.indexOf("IsActive");

  if (siPID === -1 || siService === -1 || siActive === -1) return { ok: false, status: "error", error: "ProviderServices headers invalid" };

  const serviceSet = new Set();
  for (let r = 1; r < services.length; r++) {
    const s = String(services[r][siService] || "").trim();
    const a = String(services[r][siActive] || "").trim().toLowerCase();
    if (s === serviceName && a === "yes") {
      const pid = String(services[r][siPID] || "").trim();
      if (pid) serviceSet.add(pid);
    }
  }

  if (serviceSet.size === 0) {
    return { ok: true, status: "success", service: serviceName, area: areaName, count: 0, providers: [] };
  }

  const areas = shAreas.getDataRange().getValues();
  if (areas.length < 2) return { ok: true, status: "success", service: serviceName, area: areaName, count: 0, providers: [] };

  const aHeader = areas[0].map(h => String(h).trim());
  const aiPID = aHeader.indexOf("ProviderID");
  const aiArea = aHeader.indexOf("AreaName");
  const aiActive = aHeader.indexOf("IsActive");

  if (aiPID === -1 || aiArea === -1 || aiActive === -1) return { ok: false, status: "error", error: "ProviderAreas headers invalid" };

  const matchedIds = [];
  for (let r = 1; r < areas.length; r++) {
    const area = String(areas[r][aiArea] || "").trim();
    const a = String(areas[r][aiActive] || "").trim().toLowerCase();
    if (area === areaName && a === "yes") {
      const pid = String(areas[r][aiPID] || "").trim();
      if (pid && serviceSet.has(pid)) matchedIds.push(pid);
    }
  }

  if (matchedIds.length === 0) {
    return { ok: true, status: "success", service: serviceName, area: areaName, count: 0, providers: [] };
  }

  const providers = shProviders.getDataRange().getValues();
  if (providers.length < 2) return { ok: false, status: "error", error: "Providers sheet empty" };

  const pHeader = providers[0].map(h => String(h).trim());
  const piPID = pHeader.indexOf("ProviderID");
  const piName = pHeader.indexOf("ProviderName");
  const piPhone = pHeader.indexOf("Phone");
  const piVerified = pHeader.indexOf("Verified");

  if (piPID === -1 || piName === -1 || piPhone === -1 || piVerified === -1) {
    return { ok: false, status: "error", error: "Providers headers invalid" };
  }

  const pMap = new Map();
  for (let r = 1; r < providers.length; r++) {
    const pid = String(providers[r][piPID] || "").trim();
    if (!pid) continue;
    pMap.set(pid, {
      providerId: pid,
      name: String(providers[r][piName] || "").trim(),
      phone: String(providers[r][piPhone] || "").trim(),
      verified: String(providers[r][piVerified] || "").trim().toLowerCase() === "yes" ? "yes" : "no"
    });
  }

  const out = [];
  for (const pid of matchedIds) {
    const p = pMap.get(pid);
    if (p) out.push(p);
  }

  out.sort((a, b) => (b.verified === "yes") - (a.verified === "yes"));
  const finalList = out.slice(0, limit);

  return { ok: true, status: "success", service: serviceName, area: areaName, count: finalList.length, providers: finalList };
}
