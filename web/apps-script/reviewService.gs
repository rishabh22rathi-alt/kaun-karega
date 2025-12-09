/**
 * Review service functions for Reviews sheet.
 * Relies on ADMIN_API_KEY defined in config.gs for security.
 */
var REVIEW_SHEET_NAME = "Reviews";

function getReviewsSheet() {
  return getSheetByName(REVIEW_SHEET_NAME);
}

function getAllReviews() {
  var sheet = getReviewsSheet();
  var data = sheet.getDataRange().getValues();
  var rows = mapRowsToObjects(data);
  return rows;
}
