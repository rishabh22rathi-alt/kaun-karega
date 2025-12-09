/**
 * Provider logs service for Provider_Logs sheet.
 * Relies on ADMIN_API_KEY defined in config.gs for security.
 */
var LOG_SHEET_NAME = "Provider_Logs";

function getLogsSheet() {
  return getSheetByName(LOG_SHEET_NAME);
}

function getAllLogs() {
  var sheet = getLogsSheet();
  var data = sheet.getDataRange().getValues();
  var rows = mapRowsToObjects(data);
  return rows;
}
