/*************************************************
 * KAUNKAREGA – RAW → PROVIDERS TRANSFER ENGINE
 * One generic function + separate "Run" options per category
 *************************************************/

/**
 * Generic transfer function (DO NOT run directly unless you pass args)
 */
function transferRawToProviders_(rawSheetName, category) {
  const ss = SpreadsheetApp.openById(MAIN_SPREADSHEET_ID);

  const rawSheet = ss.getSheetByName(rawSheetName);
  const providerSheet = ss.getSheetByName(PROVIDER_SHEET);

  if (!rawSheet || !providerSheet) {
    throw new Error("RAW or Providers sheet not found. RAW=" + rawSheetName + ", Providers=" + PROVIDER_SHEET);
  }

  // RAW assumed columns:
  // A SourceName, B Phone, C Area, D City, E Category, F PlaceID
  const rawData = rawSheet.getDataRange().getDisplayValues();
  const providerData = providerSheet.getDataRange().getValues();

  // Existing phone lookup (Providers col C)
  const existingPhones = new Set();
  for (let i = 1; i < providerData.length; i++) {
    const p = providerData[i][2];
    if (p) existingPhones.add(p.toString().trim());
  }

  // Find last ProviderID safely (scan upwards for PR-xxxx)
  let lastId = 0;
  for (let r = providerData.length - 1; r >= 1; r--) {
    const idCell = providerData[r][0];
    if (idCell && typeof idCell === "string" && idCell.startsWith("PR-")) {
      const n = parseInt(idCell.split("-")[1], 10);
      if (!isNaN(n)) {
        lastId = n;
        break;
      }
    }
  }

  let added = 0;
  let skippedInvalid = 0;
  let skippedDuplicate = 0;

  for (let i = 1; i < rawData.length; i++) {
    const name = (rawData[i][0] || "").toString().trim();
    let phone = (rawData[i][1] || "").toString();
    const area = (rawData[i][2] || "").toString().trim();

    if (!phone) {
      skippedInvalid++;
      continue;
    }

    // normalize phone -> digits only
    phone = phone.replace(/\D/g, "");

    // strip leading 0 if 11 digits
    if (phone.length === 11 && phone.startsWith("0")) {
      phone = phone.slice(1);
    }

    // valid Indian mobile check
    if (phone.length !== 10 || !/^[6-9]/.test(phone)) {
      skippedInvalid++;
      continue;
    }

    if (existingPhones.has(phone)) {
      skippedDuplicate++;
      continue;
    }

    lastId++;
    const providerId = "PR-" + String(lastId).padStart(4, "0");

    providerSheet.appendRow([
      providerId,     // A
      name,           // B
      phone,          // C
      category,       // D
      area,           // E
      "no"            // F Verified default
    ]);

    existingPhones.add(phone);
    added++;
  }

  Logger.log("=================================");
  Logger.log(category.toUpperCase() + " TRANSFER COMPLETE");
  Logger.log("RAW SHEET: " + rawSheetName);
  Logger.log("Added: " + added);
  Logger.log("Skipped (invalid/landline): " + skippedInvalid);
  Logger.log("Skipped (duplicate): " + skippedDuplicate);
  Logger.log("=================================");
}

/*************************************************
 * RUN OPTIONS (These appear in the dropdown)
 *************************************************/

// ✅ Option 1: Electrician
function runElectriciansTransfer_FINAL() {
  transferRawToProviders_("Kaunkarega_import_electricians", "Electrician");
}

// ✅ Option 2: Carpenter
function runCarpentersTransfer_FINAL() {
  transferRawToProviders_("Kaunkarega_import_carpenter", "Carpenter");
}

// ✅ Option 3: Painter
function runPaintersTransfer_FINAL() {
  transferRawToProviders_("Kaunkarega_import_painter", "Painter");
}
// ✅ Option 4: Plumber
function runPlumbersTransfer_FINAL() {
  transferRawToProviders_("Kaunkarega_import_Plumber", "Plumber");
}
// ✅ Option 5: Pre-Schools
function runPreschoolsTransfer_FINAL() {
  transferRawToProviders_("Kaunkarega_import_preschools", "Pre School");
}
// ✅ Option 6: Coaching Classes
function runCoachingTransfer_FINAL() {
  transferRawToProviders_("Kaunkarega_import_coaching", "Coaching Classes");
}
// ✅ Option 7: Hospitals
function runHospitalTransfer_FINAL() {
  transferRawToProviders_("kaunkarega_import_hospital", "Hospital");
}
