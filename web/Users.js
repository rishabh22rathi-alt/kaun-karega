/*************************************************
 * USERS
 *************************************************/
function touchUserLogin_(phone) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName(SHEET_USERS);
  if (!sh) throw new Error("Users sheet not found: " + SHEET_USERS);

  if (sh.getLastRow() === 0) sh.appendRow(["phone", "first_login_at", "last_login_at"]);

  const nowStr = Utilities.formatDate(new Date(), "Asia/Kolkata", "dd/MM/yyyy HH:mm:ss");
  const values = sh.getDataRange().getValues();

  let foundRow = -1;
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0] || "").trim() === phone) { foundRow = i; break; }
  }

  if (foundRow === -1) sh.appendRow([phone, nowStr, nowStr]);
  else sh.getRange(foundRow + 1, 3).setValue(nowStr);
}
