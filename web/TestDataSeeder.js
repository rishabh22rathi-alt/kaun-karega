/*************************************************
 * TEST DATA SEEDER
 * Run upsertTestProvider() from the Apps Script IDE.
 * Idempotent: safe to run multiple times.
 * Does NOT modify any existing provider data.
 *************************************************/

/**
 * Upsert a controlled test provider for manual/integration testing.
 *
 * Provider:  Granular Kids
 * Phone:     9509597100
 * Category:  Trial
 * Area:      Pratap Nagar
 *
 * Sets Verified=yes, OtpVerified=yes, PendingApproval=no
 * so this provider passes isProviderVerifiedBadgeGas_() and
 * will be returned by matchProviders_("Trial", "Pratap Nagar").
 */
function upsertTestProvider() {
  var PHONE        = "9509597100";
  var PROVIDER_NAME = "Granular Kids";
  var CATEGORY     = "Trial";
  var AREA         = "Pratap Nagar";

  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // ── 1. Open all three sheets ───────────────────────────────────────────────
  var providersSheet  = getOrCreateSheet(SHEET_PROVIDERS, [
    "ProviderID", "ProviderName", "Phone", "Category", "Areas",
    "Verified", "OtpVerified", "OtpVerifiedAt", "LastLoginAt",
    "Status", "ApprovalStatus", "PendingApproval", "CustomCategory",
    "CreatedAt", "UpdatedAt"
  ]);
  var servicesSheet = getOrCreateSheet(SHEET_PROVIDER_SERVICES, [
    "ProviderID", "ServiceName", "IsActive", "Source", "CreatedAt", "UpdatedAt"
  ]);
  var areasSheet = getOrCreateSheet(SHEET_PROVIDER_AREAS, [
    "ProviderID", "AreaName", "IsActive", "Source", "CreatedAt", "UpdatedAt"
  ]);

  var now = new Date();
  // Match the format written by verify-otp/route.ts:
  // new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
  var otpVerifiedAt = Utilities.formatDate(now, "Asia/Kolkata", "dd/MM/yyyy, h:mm:ss a");

  // ── 2. Find or create provider row in Providers sheet ─────────────────────
  var providerHeaders = ensureSheetHeaders_(providersSheet, [
    "ProviderID", "ProviderName", "Phone", "Category", "Areas",
    "Verified", "OtpVerified", "OtpVerifiedAt", "LastLoginAt",
    "Status", "ApprovalStatus", "PendingApproval", "CustomCategory",
    "CreatedAt", "UpdatedAt"
  ]);
  var headerMap    = getProviderHeaderMap_(providerHeaders);
  var providerRows = providersSheet.getDataRange().getValues();

  var existingRowNumber = -1; // 1-based sheet row index, -1 = not found
  var providerId        = "";

  for (var i = 1; i < providerRows.length; i++) {
    var row      = providerRows[i] || [];
    var rowPhone = headerMap.phone !== -1 ? normalizePhone10_(row[headerMap.phone]) : "";
    if (rowPhone === PHONE) {
      existingRowNumber = i + 1; // convert 0-based array index to 1-based row
      providerId = headerMap.providerId !== -1
        ? String(row[headerMap.providerId] || "").trim()
        : "";
      break;
    }
  }

  if (!providerId) {
    providerId = nextProviderId_(providersSheet);
  }

  // ── 3. Build and write the Providers row ──────────────────────────────────
  var providerData = {
    ProviderID:      providerId,
    Name:            PROVIDER_NAME,          // alias handled by buildProviderSheetRow_
    Phone:           PHONE,
    Category:        CATEGORY,
    Areas:           AREA,
    Verified:        "yes",
    OtpVerified:     "yes",
    OtpVerifiedAt:   otpVerifiedAt,
    LastLoginAt:     otpVerifiedAt,
    Status:          "Active",
    ApprovalStatus:  "approved",
    PendingApproval: "no",
    CustomCategory:  "",
    UpdatedAt:       now,
  };

  if (existingRowNumber === -1) {
    providerData.CreatedAt = now;
  }

  upsertProviderSheetRow_(providersSheet, providerHeaders, existingRowNumber, providerData);

  // ── 4. ProviderServices — delete existing rows for this provider, insert one ─
  deleteRowsByProvider_(servicesSheet, providerId);
  servicesSheet.appendRow([providerId, CATEGORY, "yes", "test_seed", now, now]);

  // ── 5. ProviderAreas — delete existing rows for this provider, insert one ──
  deleteRowsByProvider_(areasSheet, providerId);
  areasSheet.appendRow([providerId, AREA, "yes", "test_seed", now, now]);

  // ── 6. Report result ──────────────────────────────────────────────────────
  var action = existingRowNumber === -1 ? "CREATED" : "UPDATED";
  Logger.log("=== upsertTestProvider result ===");
  Logger.log("Action:     " + action);
  Logger.log("ProviderID: " + providerId);
  Logger.log("Name:       " + PROVIDER_NAME);
  Logger.log("Phone:      " + PHONE);
  Logger.log("Category:   " + CATEGORY + "  →  ProviderServices row written");
  Logger.log("Area:       " + AREA + "  →  ProviderAreas row written");
  Logger.log("Verified:   yes | OtpVerified: yes | PendingApproval: no");
  Logger.log("OtpVerifiedAt: " + otpVerifiedAt);
  Logger.log("isProviderVerifiedBadgeGas_ check: " + isProviderVerifiedBadgeGas_({
    Verified:        "yes",
    OtpVerified:     "yes",
    OtpVerifiedAt:   otpVerifiedAt,
    PendingApproval: "no"
  }));

  return {
    ok:         true,
    action:     action,
    providerId: providerId,
    name:       PROVIDER_NAME,
    phone:      PHONE,
    category:   CATEGORY,
    area:       AREA,
    otpVerifiedAt: otpVerifiedAt,
    verifiedBadgeCheck: isProviderVerifiedBadgeGas_({
      Verified:        "yes",
      OtpVerified:     "yes",
      OtpVerifiedAt:   otpVerifiedAt,
      PendingApproval: "no"
    })
  };
}
