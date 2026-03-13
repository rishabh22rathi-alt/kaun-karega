/**************************************
 * KAUN KAREGA — PROVIDER MAPPING SEEDER
 **************************************/

function seedMappingsFromProviders() {

  if (typeof MAIN_SPREADSHEET_ID === "undefined") {
    throw new Error("MAIN_SPREADSHEET_ID is not defined in main file.");
  }

  const SHEET_PROVIDERS = "Providers";
  const SHEET_AREAS = "ProviderAreas";
  const SHEET_SERVICES = "ProviderServices";

  const ss = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);

  const shProviders = ss.getSheetByName(SHEET_PROVIDERS);
  const shAreas = ss.getSheetByName(SHEET_AREAS);
  const shServices = ss.getSheetByName(SHEET_SERVICES);

  if (!shProviders || !shAreas || !shServices) {
    throw new Error("Missing one of these sheets: Providers, ProviderAreas, ProviderServices");
  }

  const providers = shProviders.getDataRange().getValues();
  if (providers.length < 2) return;

  const header = providers[0].map(h => String(h).trim());
  const idx = (name) => header.indexOf(name);

  const iProviderID = idx("ProviderID");
  const iCategory   = idx("Category");
  const iArea       = idx("Area");

  if (iProviderID === -1 || iCategory === -1 || iArea === -1) {
    throw new Error("Providers sheet must have headers: ProviderID, Category, Area.");
  }

  const existingAreaKeys = loadExistingKeys_(shAreas, 0, 1);
  const existingServiceKeys = loadExistingKeys_(shServices, 0, 1);

  const now = new Date();
  const source = "seed_from_providers";

  const newAreas = [];
  const newServices = [];

  for (let r = 1; r < providers.length; r++) {

    const providerId = clean_(providers[r][iProviderID]);
    if (!providerId) continue;

    const areaName = clean_(providers[r][iArea]);
    const serviceName = clean_(providers[r][iCategory]);

    if (areaName) {
      const k = providerId + "||" + areaName.toLowerCase();
      if (!existingAreaKeys.has(k)) {
        newAreas.push([providerId, areaName, "yes", source, now, now]);
        existingAreaKeys.add(k);
      }
    }

    if (serviceName) {
      const k = providerId + "||" + serviceName.toLowerCase();
      if (!existingServiceKeys.has(k)) {
        newServices.push([providerId, serviceName, "yes", source, now, now]);
        existingServiceKeys.add(k);
      }
    }
  }

  if (newAreas.length) {
    shAreas.getRange(shAreas.getLastRow() + 1, 1, newAreas.length, 6).setValues(newAreas);
  }

  if (newServices.length) {
    shServices.getRange(shServices.getLastRow() + 1, 1, newServices.length, 6).setValues(newServices);
  }

  Logger.log("Seed complete. Areas added: " + newAreas.length + 
             ", Services added: " + newServices.length);
}

function loadExistingKeys_(sheet, colAIndex, colBIndex) {
  const values = sheet.getDataRange().getValues();
  const keys = new Set();

  for (let r = 1; r < values.length; r++) {
    const a = clean_(values[r][colAIndex]);
    const b = clean_(values[r][colBIndex]);
    if (a && b) {
      keys.add(a + "||" + b.toLowerCase());
    }
  }
  return keys;
}

function clean_(v) {
  if (!v) return "";
  return String(v).trim();
}
